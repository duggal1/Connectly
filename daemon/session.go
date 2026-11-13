package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log/slog"
	"os"
	"os/exec"
	"sort"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
)

type SessionInfo struct {
	ID         string     `json:"id"`
	Shell      string     `json:"shell"`
	Created    time.Time  `json:"created"`
	Attached   bool       `json:"attached"`
	DetachedAt *time.Time `json:"detachedAt,omitempty"`
	Cols       uint16     `json:"cols"`
	Rows       uint16     `json:"rows"`
}

type Session struct {
	ID      string
	Shell   string
	Created time.Time
	Remote  string

	ptmx *os.File
	cmd  *exec.Cmd

	mu         sync.Mutex
	ring       *ring
	client     *Client
	cols, rows uint16
	detachedAt time.Time
	exited     bool
	exitCode   int
}

func randID() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func startSession(id, shell string, cols, rows uint16) (*Session, error) {
	cmd := exec.Command(shell, "-l") // login shell so PATH (Homebrew etc.) is right under launchd
	if home, err := os.UserHomeDir(); err == nil {
		cmd.Dir = home
	}
	env := append(os.Environ(), "TERM=xterm-256color", "COLORTERM=truecolor")
	if os.Getenv("LANG") == "" {
		env = append(env, "LANG=en_US.UTF-8")
	}
	cmd.Env = env
	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: rows, Cols: cols})
	if err != nil {
		return nil, err
	}
	return &Session{
		ID: id, Shell: shell, Created: time.Now(),
		ptmx: ptmx, cmd: cmd, ring: newRing(256 << 10),
		cols: cols, rows: rows, detachedAt: time.Now(),
	}, nil
}

// run pumps PTY output until the process exits.
func (s *Session) run(onDone func()) {
	buf := make([]byte, 32*1024)
	for {
		n, err := s.ptmx.Read(buf)
		if n > 0 {
			chunk := append([]byte(nil), buf[:n]...)
			s.mu.Lock()
			s.ring.write(chunk)
			c := s.client
			if c != nil {
				c.enqueue(encode(TStdout, chunk))
			}
			s.mu.Unlock()
		}
		if err != nil {
			break
		}
	}
	code := 0
	if err := s.cmd.Wait(); err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			code = ee.ExitCode()
		} else {
			code = -1
		}
	}
	s.mu.Lock()
	s.exited, s.exitCode = true, code
	c := s.client
	s.mu.Unlock()
	if c != nil {
		c.enqueue(controlFrame(map[string]any{"op": "exit", "code": code}))
		time.AfterFunc(2*time.Second, c.close)
	}
	_ = s.ptmx.Close()
	onDone()
}

func (s *Session) attach(c *Client, resumed bool, from uint64) bool {
	s.mu.Lock()
	old := s.client
	// Everything is enqueued under the lock so replay always precedes live output.
	data, base, reset := s.ring.since(from, resumed)
	c.enqueue(controlFrame(map[string]any{
		"op": "ready", "session": s.ID, "resumed": resumed,
		"reset": reset, "base": base, "cols": s.cols, "rows": s.rows,
	}))
	for len(data) > 0 {
		n := len(data)
		if n > 16<<10 {
			n = 16 << 10
		}
		c.enqueue(encode(TStdout, data[:n]))
		data = data[n:]
	}
	if s.exited {
		c.enqueue(controlFrame(map[string]any{"op": "exit", "code": s.exitCode}))
	}
	s.client = c
	s.mu.Unlock()
	if old != nil && old != c {
		old.close() // newest client wins
	}
	return reset
}

func (s *Session) detach(c *Client) {
	s.mu.Lock()
	if s.client == c {
		s.client = nil
		s.detachedAt = time.Now()
	}
	s.mu.Unlock()
}

func (s *Session) write(p []byte) {
	_, _ = s.ptmx.Write(p)
}

func (s *Session) resize(cols, rows uint16) {
	if cols == 0 || rows == 0 {
		return
	}
	s.mu.Lock()
	s.cols, s.rows = cols, rows
	s.mu.Unlock()
	_ = pty.Setsize(s.ptmx, &pty.Winsize{Rows: rows, Cols: cols})
}

// redraw forces SIGWINCH so full-screen apps repaint after a resume.
func (s *Session) redraw() {
	s.mu.Lock()
	cols, rows := s.cols, s.rows
	s.mu.Unlock()
	if cols < 2 {
		return
	}
	_ = pty.Setsize(s.ptmx, &pty.Winsize{Rows: rows, Cols: cols - 1})
	time.Sleep(40 * time.Millisecond)
	_ = pty.Setsize(s.ptmx, &pty.Winsize{Rows: rows, Cols: cols})
}

func (s *Session) kill() {
	s.mu.Lock()
	done := s.exited
	s.mu.Unlock()
	if done {
		return
	}
	if s.cmd.Process == nil {
		return
	}
	pid := s.cmd.Process.Pid
	_ = syscall.Kill(-pid, syscall.SIGHUP)
	time.AfterFunc(3*time.Second, func() {
		s.mu.Lock()
		done := s.exited
		s.mu.Unlock()
		if !done {
			_ = syscall.Kill(-pid, syscall.SIGKILL)
		}
	})
}

func (s *Session) info() SessionInfo {
	s.mu.Lock()
	defer s.mu.Unlock()
	i := SessionInfo{ID: s.ID, Shell: s.Shell, Created: s.Created, Attached: s.client != nil, Cols: s.cols, Rows: s.rows}
	if s.client == nil {
		t := s.detachedAt
		i.DetachedAt = &t
	}
	return i
}

// ---------------------------------------------------------------------

type Manager struct {
	mu       sync.Mutex
	sessions map[string]*Session
	shell    string
	max      int
	wake     *Wake
}

func newManager(shell string, max int, wake *Wake) *Manager {
	return &Manager{sessions: map[string]*Session{}, shell: shell, max: max, wake: wake}
}

func (m *Manager) create(cols, rows uint16) (*Session, error) {
	m.mu.Lock()
	if len(m.sessions) >= m.max {
		m.mu.Unlock()
		return nil, errors.New("session limit reached")
	}
	m.mu.Unlock()

	m.wake.Acquire()
	id := randID()
	s, err := startSession(id, m.shell, cols, rows)
	if err != nil {
		m.wake.Release()
		return nil, err
	}
	m.mu.Lock()
	m.sessions[id] = s
	m.mu.Unlock()
	go s.run(func() {
		m.mu.Lock()
		delete(m.sessions, id)
		m.mu.Unlock()
		m.wake.Release()
		slog.Info("session ended", "session", id)
	})
	slog.Info("session started", "session", id)
	return s, nil
}

func (m *Manager) get(id string) *Session {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sessions[id]
}

func (m *Manager) list() []SessionInfo {
	m.mu.Lock()
	all := make([]*Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		all = append(all, s)
	}
	m.mu.Unlock()
	out := make([]SessionInfo, 0, len(all))
	for _, s := range all {
		out = append(out, s.info())
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Created.Before(out[j].Created) })
	return out
}

func (m *Manager) killAll() {
	m.mu.Lock()
	all := make([]*Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		all = append(all, s)
	}
	m.mu.Unlock()
	for _, s := range all {
		s.kill()
	}
}

func (m *Manager) reapLoop(ctx context.Context, ttl time.Duration) {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			m.mu.Lock()
			all := make([]*Session, 0, len(m.sessions))
			for _, s := range m.sessions {
				all = append(all, s)
			}
			m.mu.Unlock()
			for _, s := range all {
				s.mu.Lock()
				stale := s.client == nil && time.Since(s.detachedAt) > ttl
				s.mu.Unlock()
				if stale {
					slog.Info("reaping idle session", "session", s.ID)
					s.kill()
				}
			}
		}
	}
}
