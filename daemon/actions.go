package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

var (
	errDisabled = errors.New("not enabled in actions.json")
	errNoAction = errors.New("no such action")
	errBusy     = errors.New("already running")
	errBadInput = errors.New("bad input")
)

const (
	maxClip   = 64 << 10
	maxOutput = 8 << 10
)

var idRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,31}$`)

type ActionsConfig struct {
	Clipboard bool     `json:"clipboard"`
	Volume    bool     `json:"volume"`
	Roots     []string `json:"roots"`
	Actions   []Action `json:"actions"`
}

type Action struct {
	ID      string   `json:"id"`
	Label   string   `json:"label"`
	Kind    string   `json:"kind"`
	Target  string   `json:"target"`
	Args    []string `json:"args,omitempty"`
	Timeout int      `json:"timeoutSec,omitempty"`
}

type ActionInfo struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Kind    string `json:"kind"`
	Timeout int    `json:"timeoutSec"`
}

type Capabilities struct {
	Clipboard bool         `json:"clipboard"`
	Volume    bool         `json:"volume"`
	Open      bool         `json:"open"`
	Visual    bool         `json:"visual"`
	Actions   []ActionInfo `json:"actions"`
}

type Result struct {
	OK     bool   `json:"ok"`
	Code   int    `json:"code"`
	Output string `json:"output"`
	Ms     int64  `json:"ms"`
}

type Actions struct {
	shell     string
	clipboard bool
	volume    bool
	roots     []string
	byID      map[string]Action
	order     []string

	mu   sync.Mutex
	busy map[string]bool
}

func newActions(shell string) *Actions {
	return &Actions{shell: shell, byID: map[string]Action{}, busy: map[string]bool{}}
}

func expandHome(path string) string {
	if path == "~" || strings.HasPrefix(path, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, strings.TrimPrefix(path, "~"))
		}
	}
	return path
}

func loadActions(path, shell string) (*Actions, error) {
	if path == "" {
		path = filepath.Join(configDir(), "actions.json")
	}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return newActions(shell), nil
	}
	if err != nil {
		return newActions(shell), err
	}
	var cfg ActionsConfig
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&cfg); err != nil {
		return newActions(shell), fmt.Errorf("%s: %w", path, err)
	}
	if err := ensureJSONEOF(dec); err != nil {
		return newActions(shell), fmt.Errorf("%s: %w", path, err)
	}
	if len(cfg.Actions) > 128 || len(cfg.Roots) > 64 {
		return newActions(shell), errors.New("actions.json has too many entries")
	}

	a := newActions(shell)
	a.clipboard, a.volume = cfg.Clipboard, cfg.Volume
	for _, root := range cfg.Roots {
		real, err := filepath.EvalSymlinks(expandHome(root))
		if err != nil || !filepath.IsAbs(real) {
			return newActions(shell), fmt.Errorf("root %q must be an existing absolute folder", root)
		}
		st, err := os.Stat(real)
		if err != nil || !st.IsDir() {
			return newActions(shell), fmt.Errorf("root %q must be an existing folder", root)
		}
		a.roots = append(a.roots, real)
	}
	for _, action := range cfg.Actions {
		if err := validate(&action); err != nil {
			return newActions(shell), fmt.Errorf("action %q: %w", action.ID, err)
		}
		if _, exists := a.byID[action.ID]; exists {
			return newActions(shell), fmt.Errorf("action %q: duplicate id", action.ID)
		}
		a.byID[action.ID] = action
		a.order = append(a.order, action.ID)
	}
	return a, nil
}

func ensureJSONEOF(dec *json.Decoder) error {
	var extra any
	if err := dec.Decode(&extra); err == nil {
		return errors.New("multiple JSON values")
	} else if !errors.Is(err, io.EOF) {
		return err
	}
	return nil
}

func validate(action *Action) error {
	if !idRe.MatchString(action.ID) {
		return errors.New("id must be lowercase letters, digits and dashes")
	}
	if action.Label == "" {
		action.Label = action.ID
	}
	if len(action.Label) > 80 || strings.TrimSpace(action.Label) != action.Label {
		return errors.New("label must be 1 to 80 characters without surrounding whitespace")
	}
	if action.Target == "" || strings.HasPrefix(action.Target, "-") {
		return errors.New("target is required and can't start with a dash")
	}
	if action.Timeout <= 0 {
		action.Timeout = 30
	}
	if action.Timeout > 600 {
		return errors.New("timeoutSec can't exceed 600")
	}
	switch action.Kind {
	case "app", "shortcut":
		if len(action.Args) != 0 {
			return errors.New("args are supported only for scripts")
		}
	case "path":
		if len(action.Args) != 0 {
			return errors.New("args are supported only for scripts")
		}
		action.Target = expandHome(action.Target)
		if !filepath.IsAbs(action.Target) {
			return errors.New("path must be absolute")
		}
	case "script":
		action.Target = expandHome(action.Target)
		st, err := os.Stat(action.Target)
		if err != nil || !filepath.IsAbs(action.Target) || st.IsDir() || st.Mode()&0o111 == 0 {
			return errors.New("script must be an absolute path to an executable file")
		}
	default:
		return fmt.Errorf("unknown kind %q", action.Kind)
	}
	return nil
}

func (a *Actions) Capabilities() Capabilities {
	caps := Capabilities{
		Clipboard: a.clipboard,
		Volume:    a.volume,
		Open:      len(a.roots) > 0,
		Actions:   make([]ActionInfo, 0, len(a.order)),
	}
	for _, id := range a.order {
		action := a.byID[id]
		caps.Actions = append(caps.Actions, ActionInfo{ID: action.ID, Label: action.Label, Kind: action.Kind, Timeout: action.Timeout})
	}
	return caps
}

func (a *Actions) acquire(id string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.busy[id] {
		return false
	}
	a.busy[id] = true
	return true
}

func (a *Actions) release(id string) {
	a.mu.Lock()
	delete(a.busy, id)
	a.mu.Unlock()
}

func (a *Actions) Run(id string) (Result, error) {
	action, ok := a.byID[id]
	if !ok {
		return Result{}, errNoAction
	}
	if !a.acquire(id) {
		return Result{}, errBusy
	}
	defer a.release(id)

	timeout := time.Duration(action.Timeout) * time.Second
	switch action.Kind {
	case "app":
		return execute(timeout, "/usr/bin/open", "-a", action.Target), nil
	case "path":
		return execute(timeout, "/usr/bin/open", action.Target), nil
	case "shortcut":
		return execute(timeout, "/usr/bin/shortcuts", "run", action.Target), nil
	default:
		args := append([]string{"-l", "-c", `exec "$0" "$@"`, action.Target}, action.Args...)
		return execute(timeout, a.shell, args...), nil
	}
}

func (a *Actions) ClipboardGet() (string, error) {
	if !a.clipboard {
		return "", errDisabled
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "/usr/bin/pbpaste")
	cmd.Env = utf8Env()
	out := &capped{max: maxClip}
	cmd.Stdout = out
	if err := cmd.Run(); err != nil {
		return "", err
	}
	return strings.ToValidUTF8(out.buf.String(), ""), nil
}

func (a *Actions) ClipboardSet(text string) error {
	if !a.clipboard {
		return errDisabled
	}
	if len(text) > maxClip {
		return fmt.Errorf("%w: clipboard text over 64 KB", errBadInput)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "/usr/bin/pbcopy")
	cmd.Env = utf8Env()
	cmd.Stdin = strings.NewReader(text)
	return cmd.Run()
}

func (a *Actions) SetVolume(level int) error {
	if !a.volume {
		return errDisabled
	}
	if level < 0 || level > 100 {
		return fmt.Errorf("%w: volume is 0 to 100", errBadInput)
	}
	result := execute(5*time.Second, "/usr/bin/osascript", "-e", "set volume output volume "+strconv.Itoa(level))
	if !result.OK {
		return errors.New(result.Output)
	}
	return nil
}

func (a *Actions) OpenPath(path string) error {
	if len(a.roots) == 0 {
		return errDisabled
	}
	path = expandHome(path)
	if !filepath.IsAbs(path) {
		return fmt.Errorf("%w: path must be absolute", errBadInput)
	}
	real, err := filepath.EvalSymlinks(path)
	if err != nil {
		return fmt.Errorf("%w: no such path", errBadInput)
	}
	for _, root := range a.roots {
		rel, err := filepath.Rel(root, real)
		if err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			result := execute(10*time.Second, "/usr/bin/open", real)
			if !result.OK {
				return errors.New(result.Output)
			}
			return nil
		}
	}
	return fmt.Errorf("%w: outside the allowed folders", errBadInput)
}

func utf8Env() []string { return append(os.Environ(), "LANG=en_US.UTF-8") }

type capped struct {
	buf bytes.Buffer
	max int
}

func (c *capped) Write(p []byte) (int, error) {
	if room := c.max - c.buf.Len(); room > 0 {
		if len(p) > room {
			_, _ = c.buf.Write(p[:room])
		} else {
			_, _ = c.buf.Write(p)
		}
	}
	return len(p), nil
}

func execute(timeout time.Duration, name string, args ...string) Result {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return os.ErrProcessDone
		}
		return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
	cmd.WaitDelay = 2 * time.Second
	out := &capped{max: maxOutput}
	cmd.Stdout, cmd.Stderr = out, out
	started := time.Now()
	err := cmd.Run()
	result := Result{OK: err == nil, Output: strings.TrimSpace(out.buf.String()), Ms: time.Since(started).Milliseconds()}
	if err != nil {
		var exitErr *exec.ExitError
		switch {
		case errors.Is(ctx.Err(), context.DeadlineExceeded):
			result.Code = -1
			result.Output = strings.TrimSpace(result.Output + "\nTimed out.")
		case errors.As(err, &exitErr):
			result.Code = exitErr.ExitCode()
		default:
			result.Code = -1
			result.Output = err.Error()
		}
	}
	return result
}
