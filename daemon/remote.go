package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
)

type RemoteSessionInfo struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	CreatedAt  int64  `json:"createdAt"`
	LastActive int64  `json:"lastActive"`
	Windows    int    `json:"windows"`
	Panes      int    `json:"panes"`
	MacClients int    `json:"macClients"`
	Phones     int    `json:"phones"`
	Cols       int    `json:"cols"`
	Rows       int    `json:"rows"`
	Command    string `json:"command"`
	Agent      string `json:"agent"`
	State      string `json:"state"`
	Title      string `json:"title"`
	Cwd        string `json:"cwd"`
	Preview    string `json:"preview"`
}

type LooseAgent struct {
	PID       int    `json:"pid"`
	Agent     string `json:"agent"`
	TTY       string `json:"tty"`
	Cwd       string `json:"cwd"`
	StartedAt int64  `json:"startedAt"`
	State     string `json:"state"`
}

type RemoteSnapshot struct {
	Type     string              `json:"type"`
	At       int64               `json:"at"`
	Host     string              `json:"host"`
	Sessions []RemoteSessionInfo `json:"sessions"`
	Loose    []LooseAgent        `json:"loose"`
}

type observedSession struct {
	activity int64
	changed  time.Time
	hash     uint64
	preview  string
}

type observedProcess struct {
	startedAt int64
	command   string
	cwd       string
}

type Remote struct {
	tmux *Tmux
	wake *Wake
	host string
	log  *slog.Logger

	pollMu sync.Mutex
	mu     sync.Mutex
	ready  bool
	seen   map[string]*observedSession
	meta   map[int]observedProcess
	phones map[string]int
	last   RemoteSnapshot
}

func newRemote(cfg Config, wake *Wake) (*Remote, error) {
	tmux, err := newTmux(cfg)
	if err != nil {
		return nil, err
	}
	host, _ := os.Hostname()
	return &Remote{
		tmux: tmux, wake: wake, host: host, log: slog.Default(),
		seen: map[string]*observedSession{}, meta: map[int]observedProcess{}, phones: map[string]int{},
		last: RemoteSnapshot{Type: "sessions", Host: host, Sessions: []RemoteSessionInfo{}, Loose: []LooseAgent{}},
	}, nil
}

func (r *Remote) ensure() error {
	r.mu.Lock()
	if r.ready {
		r.mu.Unlock()
		return nil
	}
	r.mu.Unlock()
	if err := r.tmux.ensure(); err != nil {
		return err
	}
	r.mu.Lock()
	r.ready = true
	r.mu.Unlock()
	return nil
}

func (r *Remote) run(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		if err := r.refresh(); err != nil {
			r.log.Warn("remote session refresh failed", "err", err)
		}
		select {
		case <-ctx.Done():
			r.wake.SetReason("remote", false)
			return
		case <-ticker.C:
		}
	}
}

func (r *Remote) create(name, cwd, command string, cols, rows int) (string, string, error) {
	if err := r.ensure(); err != nil {
		return "", "", err
	}
	return r.tmux.create(name, cwd, command, cols, rows)
}

func (r *Remote) rename(id, name string) (string, error) {
	if err := r.ensure(); err != nil {
		return "", err
	}
	if err := r.requireVisible(id); err != nil {
		return "", err
	}
	return r.tmux.rename(id, name)
}

func (r *Remote) kill(id string) error {
	if err := r.ensure(); err != nil {
		return err
	}
	if err := r.requireVisible(id); err != nil {
		return err
	}
	return r.tmux.kill(id)
}

func (r *Remote) interrupt(id string) error {
	if err := r.ensure(); err != nil {
		return err
	}
	if err := r.requireVisible(id); err != nil {
		return err
	}
	return r.tmux.sendKeys(id, "C-c")
}

func (r *Remote) sendKeys(id string, keys []string) error {
	if len(keys) == 0 || len(keys) > 32 {
		return errors.New("send between 1 and 32 keys")
	}
	for _, key := range keys {
		if key == "" || len(key) > 32 || strings.ContainsAny(key, "\r\n\x00") {
			return errors.New("key values must be between 1 and 32 characters")
		}
	}
	if err := r.ensure(); err != nil {
		return err
	}
	if err := r.requireVisible(id); err != nil {
		return err
	}
	return r.tmux.sendKeys(id, keys...)
}

func (r *Remote) detachOthers(id string) error {
	if err := r.ensure(); err != nil {
		return err
	}
	if err := r.requireVisible(id); err != nil {
		return err
	}
	return r.tmux.detachOthers(id)
}

func (r *Remote) openClient(id string, cols, rows uint16) (*Session, error) {
	if err := r.ensure(); err != nil {
		return nil, err
	}
	visible, err := r.tmux.visibleSession(id)
	if err != nil {
		return nil, err
	}
	if !visible {
		return nil, errRemoteSession
	}
	command := exec.Command(r.tmux.bin, "-u", "-S", r.tmux.sock, "attach-session", "-t", id)
	if home, err := os.UserHomeDir(); err == nil {
		command.Dir = home
	}
	command.Env = terminalEnv()
	ptmx, err := pty.StartWithSize(command, &pty.Winsize{Rows: rows, Cols: cols})
	if err != nil {
		return nil, err
	}
	session := &Session{
		ID: randID(), Shell: "tmux " + id, Created: time.Now(), Remote: id,
		ptmx: ptmx, cmd: command, ring: newRing(256 << 10), cols: cols, rows: rows, detachedAt: time.Now(),
	}
	r.mu.Lock()
	r.phones[id]++
	r.mu.Unlock()
	go session.run(func() {})
	return session, nil
}

func (r *Remote) requireVisible(id string) error {
	visible, err := r.tmux.visibleSession(id)
	if err != nil {
		return err
	}
	if !visible {
		return errRemoteSession
	}
	return nil
}

func (r *Remote) clientDone(session *Session) {
	session.kill()
	r.mu.Lock()
	if r.phones[session.Remote] <= 1 {
		delete(r.phones, session.Remote)
	} else {
		r.phones[session.Remote]--
	}
	r.mu.Unlock()
}

func (r *Remote) scroll(id, direction string, lines int) (tmuxScrollState, error) {
	if err := r.ensure(); err != nil {
		return tmuxScrollState{}, err
	}
	return r.tmux.scroll(id, direction, lines)
}

func (r *Remote) scrollState(id string) (tmuxScrollState, error) {
	return r.tmux.scrollState(id)
}

func (r *Remote) stopLoose(pid int, startedAt int64, how string) error {
	if pid <= 1 || startedAt <= 0 {
		return errors.New("invalid process identity")
	}
	if err := r.ensure(); err != nil {
		return err
	}
	processes, children := readProcesses()
	process := processes[pid]
	if process == nil || process.uid != os.Getuid() || process.startedAt != startedAt || agentOf(process.args) == "" {
		return errors.New("that process is gone or changed")
	}
	managed := make(map[int]bool)
	rows, err := r.tmux.panes()
	if err != nil {
		return err
	}
	for _, pane := range rows {
		managed[pane.PID] = true
		for _, child := range descendProcesses(pane.PID, children) {
			managed[child] = true
		}
	}
	if managed[pid] || process.tty == "??" || process.tty == "?" || process.tty == "" {
		return errors.New("that process is no longer outside tmux")
	}
	signal := syscall.SIGINT
	switch how {
	case "int":
		signal = syscall.SIGINT
	case "term":
		signal = syscall.SIGTERM
	case "kill":
		signal = syscall.SIGKILL
	default:
		return errors.New("unsupported stop action")
	}
	return syscall.Kill(pid, signal)
}

func terminalEnv() []string {
	env := make([]string, 0, len(os.Environ())+2)
	for _, entry := range os.Environ() {
		if strings.HasPrefix(entry, "TMUX=") || strings.HasPrefix(entry, "TMUX_PANE=") {
			continue
		}
		env = append(env, entry)
	}
	return append(env, "TERM=xterm-256color", "COLORTERM=truecolor")
}
