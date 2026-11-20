package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var (
	errTmuxUnavailable = errors.New("tmux is unavailable")
	errRemoteSession   = errors.New("remote session no longer exists")
	errBadSessionID    = errors.New("invalid remote session id")
)

const tmuxFieldSeparator = "\x1f"

var tmuxSessionIDRE = regexp.MustCompile(`^\$[0-9]+$`)
var invalidTmuxNameRE = regexp.MustCompile(`[^A-Za-z0-9 _-]+`)

type Tmux struct {
	bin   string
	sock  string
	mouse bool
}

func defaultTmuxSocket() string {
	return filepath.Join(configDir(), "tmux.sock")
}

func newTmux(cfg Config) (*Tmux, error) {
	bin := strings.TrimSpace(cfg.TmuxBin)
	if bin == "" {
		bin, _ = exec.LookPath("tmux")
	}
	if bin == "" {
		for _, candidate := range []string{"/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"} {
			if _, err := os.Stat(candidate); err == nil {
				bin = candidate
				break
			}
		}
	}
	if bin == "" {
		return nil, errTmuxUnavailable
	}
	sock := cfg.TmuxSocket
	if sock == "" {
		sock = defaultTmuxSocket()
	}
	if !filepath.IsAbs(sock) {
		return nil, errors.New("tmux socket path must be absolute")
	}
	return &Tmux{bin: bin, sock: sock, mouse: cfg.TmuxMouse}, nil
}

func (t *Tmux) run(args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	all := append([]string{"-u", "-S", t.sock}, args...)
	cmd := exec.CommandContext(ctx, t.bin, all...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return stdout.String(), errors.New(message)
	}
	return stdout.String(), nil
}

func (t *Tmux) ensure() error {
	if err := os.MkdirAll(filepath.Dir(t.sock), 0o700); err != nil {
		return err
	}
	if _, err := t.run("has-session", "-t", "=_connectly_keepalive"); err != nil {
		_, createErr := t.run("new-session", "-d", "-s", "_connectly_keepalive", "-x", "80", "-y", "24", "exec tail -f /dev/null")
		if createErr != nil && !strings.Contains(strings.ToLower(createErr.Error()), "duplicate") {
			return createErr
		}
	}
	mouse := "off"
	if t.mouse {
		mouse = "on"
	}
	options := [][]string{
		{"set-option", "-s", "exit-empty", "off"},
		{"set-option", "-g", "status", "off"},
		{"set-option", "-g", "mouse", mouse},
		{"set-option", "-g", "history-limit", "50000"},
		{"set-option", "-g", "escape-time", "0"},
		{"set-option", "-g", "focus-events", "on"},
		{"set-option", "-g", "window-size", "latest"},
		{"set-option", "-g", "default-terminal", "screen-256color"},
		{"set-option", "-g", "terminal-overrides", ",*:Tc"},
		{"set-option", "-g", "set-titles", "off"},
	}
	for _, option := range options {
		_, _ = t.run(option...) // Keep older tmux versions usable when an option is unavailable.
	}
	if info, err := os.Stat(t.sock); err == nil && info.Mode()&os.ModeSocket != 0 {
		_ = os.Chmod(t.sock, 0o600)
	}
	return nil
}

func validTmuxSessionID(id string) bool { return tmuxSessionIDRE.MatchString(id) }

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}

func tmuxHook(socket string) string {
	quoted := shellQuote(socket)
	return "# Connectly: keep interactive terminal work attachable from the phone\n" +
		"if [[ -o interactive && -t 0 && -z \"${TMUX:-}\" && -z \"${PT_NO_TMUX:-}\" && \"${TERM_PROGRAM:-}\" != \"vscode\" ]] && command -v tmux >/dev/null 2>&1; then\n" +
		"  exec tmux -u -S " + quoted + " new-session -A -s \"mac-$$\"\n" +
		"fi\n" +
		"alias pt=" + shellQuote("tmux -u -S "+socket) + "\n"
}

type tmuxPane struct {
	SessionID string
	Name      string
	Created   int64
	Attached  int
	Windows   int
	WindowOn  bool
	PaneOn    bool
	Activity  int64
	PID       int
	Cols      int
	Rows      int
	Command   string
	Title     string
	Path      string
}

const tmuxPaneFormat = "#{session_id}" + tmuxFieldSeparator +
	"#{session_name}" + tmuxFieldSeparator +
	"#{session_created}" + tmuxFieldSeparator +
	"#{session_attached}" + tmuxFieldSeparator +
	"#{session_windows}" + tmuxFieldSeparator +
	"#{window_active}" + tmuxFieldSeparator +
	"#{pane_active}" + tmuxFieldSeparator +
	"#{window_activity}" + tmuxFieldSeparator +
	"#{pane_pid}" + tmuxFieldSeparator +
	"#{pane_width}" + tmuxFieldSeparator +
	"#{pane_height}" + tmuxFieldSeparator +
	"#{pane_current_command}" + tmuxFieldSeparator +
	"#{pane_title}" + tmuxFieldSeparator +
	"#{pane_current_path}"

func parseInt(s string) int {
	n, _ := strconv.Atoi(strings.TrimSpace(s))
	return n
}

func parseInt64(s string) int64 {
	n, _ := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
	return n
}

func (t *Tmux) panes() ([]tmuxPane, error) {
	output, err := t.run("list-panes", "-a", "-F", tmuxPaneFormat)
	if err != nil {
		if tmuxServerMissing(err) {
			return nil, nil
		}
		return nil, err
	}
	rows := make([]tmuxPane, 0)
	for _, line := range strings.Split(strings.TrimRight(output, "\n"), "\n") {
		fields := strings.SplitN(line, tmuxFieldSeparator, 14)
		if len(fields) != 14 {
			continue
		}
		rows = append(rows, tmuxPane{
			SessionID: fields[0], Name: fields[1], Created: parseInt64(fields[2]),
			Attached: parseInt(fields[3]), Windows: parseInt(fields[4]),
			WindowOn: fields[5] == "1", PaneOn: fields[6] == "1", Activity: parseInt64(fields[7]),
			PID: parseInt(fields[8]), Cols: parseInt(fields[9]), Rows: parseInt(fields[10]),
			Command: fields[11], Title: fields[12], Path: fields[13],
		})
	}
	return rows, nil
}

func tmuxServerMissing(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "no server running") ||
		strings.Contains(message, "error connecting") ||
		strings.Contains(message, "no such file")
}

func (t *Tmux) visibleSession(id string) (bool, error) {
	if !validTmuxSessionID(id) {
		return false, errBadSessionID
	}
	rows, err := t.panes()
	if err != nil {
		return false, err
	}
	for _, row := range rows {
		if row.SessionID == id && !strings.HasPrefix(row.Name, "_") {
			return true, nil
		}
	}
	return false, errRemoteSession
}

func (t *Tmux) capture(id string) (string, error) {
	if !validTmuxSessionID(id) {
		return "", errBadSessionID
	}
	return t.run("capture-pane", "-p", "-t", id)
}

func safeSessionName(name string) string {
	name = strings.TrimSpace(name)
	name = invalidTmuxNameRE.ReplaceAllString(name, "-")
	name = strings.Trim(name, " -_")
	if len(name) > 40 {
		name = name[:40]
	}
	if name == "" {
		return "Shell"
	}
	return name
}

func (t *Tmux) create(name, cwd, command string, cols, rows int) (string, string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", "", err
	}
	if cwd == "" {
		cwd = home
	} else if cwd == "~" || strings.HasPrefix(cwd, "~/") {
		cwd = filepath.Join(home, strings.TrimPrefix(cwd, "~"))
	}
	if !filepath.IsAbs(cwd) {
		return "", "", errors.New("working directory must be absolute")
	}
	if info, statErr := os.Stat(cwd); statErr != nil || !info.IsDir() {
		return "", "", errors.New("working directory must be an existing folder")
	}
	if cols < 20 || cols > 400 {
		cols = 80
	}
	if rows < 5 || rows > 200 {
		rows = 24
	}
	base := safeSessionName(name)
	var lastErr error
	for attempt := 0; attempt < 20; attempt++ {
		candidate := base
		if attempt > 0 {
			candidate = fmt.Sprintf("%s-%d", base, attempt+1)
		}
		idOutput, err := t.run("new-session", "-d", "-P", "-F", "#{session_id}", "-s", candidate, "-x", strconv.Itoa(cols), "-y", strconv.Itoa(rows), "-c", cwd)
		if err != nil {
			lastErr = err
			if !strings.Contains(strings.ToLower(err.Error()), "duplicate") {
				return "", "", err
			}
			continue
		}
		id := strings.TrimSpace(idOutput)
		if !validTmuxSessionID(id) {
			_, _ = t.run("kill-session", "-t", "="+candidate)
			return "", "", errors.New("tmux returned an invalid session id")
		}
		command = strings.TrimSpace(command)
		if command != "" {
			if len(command) > 512 || strings.ContainsAny(command, "\r\n\x00") {
				_, _ = t.run("kill-session", "-t", id)
				return "", "", errors.New("initial command is invalid")
			}
			if _, err := t.run("send-keys", "-t", id, "-l", command); err != nil {
				_, _ = t.run("kill-session", "-t", id)
				return "", "", err
			}
			if _, err := t.run("send-keys", "-t", id, "Enter"); err != nil {
				_, _ = t.run("kill-session", "-t", id)
				return "", "", err
			}
		}
		return id, candidate, nil
	}
	return "", "", lastErr
}

func (t *Tmux) kill(id string) error {
	if !validTmuxSessionID(id) {
		return errBadSessionID
	}
	_, err := t.run("kill-session", "-t", id)
	if err != nil && (tmuxServerMissing(err) || strings.Contains(strings.ToLower(err.Error()), "can't find session")) {
		return errRemoteSession
	}
	return err
}

func (t *Tmux) rename(id, name string) (string, error) {
	if !validTmuxSessionID(id) {
		return "", errBadSessionID
	}
	name = safeSessionName(name)
	_, err := t.run("rename-session", "-t", id, name)
	return name, err
}

func (t *Tmux) sendKeys(id string, keys ...string) error {
	if !validTmuxSessionID(id) {
		return errBadSessionID
	}
	args := append([]string{"send-keys", "-t", id}, keys...)
	_, err := t.run(args...)
	return err
}

func (t *Tmux) detachOthers(id string) error {
	if !validTmuxSessionID(id) {
		return errBadSessionID
	}
	_, err := t.run("detach-client", "-a", "-s", id)
	return err
}

type tmuxScrollState struct {
	InMode   bool
	Position int
	History  int
	Activity int64
}

func (t *Tmux) scroll(id, direction string, lines int) (tmuxScrollState, error) {
	if !validTmuxSessionID(id) {
		return tmuxScrollState{}, errBadSessionID
	}
	count := strconv.Itoa(min(max(lines, 1), 400))
	switch direction {
	case "up":
		if _, err := t.run("copy-mode", "-e", "-t", id); err != nil {
			return tmuxScrollState{}, err
		}
		_, _ = t.run("send-keys", "-X", "-t", id, "-N", count, "scroll-up")
	case "down":
		_, _ = t.run("send-keys", "-X", "-t", id, "-N", count, "scroll-down")
	case "live":
		_, _ = t.run("send-keys", "-X", "-t", id, "cancel")
	default:
		return tmuxScrollState{}, errors.New("invalid scroll direction")
	}
	return t.scrollState(id)
}

func (t *Tmux) scrollState(id string) (tmuxScrollState, error) {
	if !validTmuxSessionID(id) {
		return tmuxScrollState{}, errBadSessionID
	}
	out, err := t.run("display-message", "-p", "-t", id, "#{pane_in_mode}|#{scroll_position}|#{history_size}|#{window_activity}")
	if err != nil {
		return tmuxScrollState{}, err
	}
	fields := strings.Split(strings.TrimSpace(out), "|")
	if len(fields) != 4 {
		return tmuxScrollState{}, errors.New("tmux returned invalid scroll state")
	}
	return tmuxScrollState{InMode: fields[0] == "1", Position: parseInt(fields[1]), History: parseInt(fields[2]), Activity: parseInt64(fields[3])}, nil
}
