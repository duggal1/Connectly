package main

import (
	"context"
	"log/slog"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Wake holds a caffeinate assertion while sessions exist and can temporarily
// disable lid-close sleep when the narrow sudoers rule is installed.
type Wake struct {
	mu      sync.Mutex
	n       int
	reasons map[string]bool
	cmd     *exec.Cmd
	enabled bool
	lid     bool
	minBatt int
	stats   *StatsSource
	lidOn   bool
	warned  bool
}

func newWake(enabled, lid bool, minBatt int, stats *StatsSource) *Wake {
	return &Wake{enabled: enabled, lid: lid, minBatt: minBatt, stats: stats, reasons: map[string]bool{}}
}

// Init clears a stale hold left by a crashed run.
func (w *Wake) Init() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.setLid(false, true)
}

func (w *Wake) Acquire() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.n++
	w.apply()
}

func (w *Wake) Release() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.n > 0 {
		w.n--
	}
	w.apply()
}

func (w *Wake) SetReason(reason string, active bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.reasons == nil {
		w.reasons = map[string]bool{}
	}
	if active {
		w.reasons[reason] = true
	} else {
		delete(w.reasons, reason)
	}
	w.apply()
}

func (w *Wake) Shutdown() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.n = 0
	w.reasons = map[string]bool{}
	w.stopCaffeinate()
	if w.lidOn {
		w.setLid(false, true)
	}
}

func (w *Wake) loop(ctx context.Context) {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			w.mu.Lock()
			w.setLid(w.wantLid(), false)
			w.mu.Unlock()
		}
	}
}

func (w *Wake) wantLid() bool {
	if !w.enabled || !w.lid || !w.wantedLocked() || w.stats == nil {
		return false
	}
	st := w.stats.Get()
	if st.Battery != nil && st.Source == "battery" && *st.Battery < w.minBatt {
		return false
	}
	return true
}

func (w *Wake) apply() {
	if w.enabled && w.wantedLocked() {
		w.startCaffeinate()
	} else {
		w.stopCaffeinate()
	}
	w.setLid(w.wantLid(), false)
}

func (w *Wake) wantedLocked() bool {
	if w.n > 0 {
		return true
	}
	for _, active := range w.reasons {
		if active {
			return true
		}
	}
	return false
}

func (w *Wake) startCaffeinate() {
	if w.cmd != nil {
		return
	}
	cmd := exec.Command("/usr/bin/caffeinate", "-i", "-s", "-w", strconv.Itoa(os.Getpid()))
	if err := cmd.Start(); err != nil {
		slog.Warn("caffeinate unavailable", "err", err)
		return
	}
	w.cmd = cmd
	go func() {
		_ = cmd.Wait()
		w.mu.Lock()
		if w.cmd == cmd {
			w.cmd = nil
		}
		w.mu.Unlock()
	}()
}

func (w *Wake) stopCaffeinate() {
	if w.cmd == nil {
		return
	}
	cmd := w.cmd
	w.cmd = nil
	if cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}

func (w *Wake) setLid(on, force bool) {
	if (on && (!w.enabled || !w.lid)) || (!force && on == w.lidOn) {
		return
	}
	v := "0"
	if on {
		v = "1"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "/usr/bin/sudo", "-n", "/usr/bin/pmset", "-a", "disablesleep", v).CombinedOutput()
	if err != nil {
		if !w.warned {
			w.warned = true
			slog.Warn("lid hold unavailable; run install.sh to add the sudoers rule", "err", err, "out", strings.TrimSpace(string(out)))
		}
		return
	}
	w.lidOn = on
	slog.Info("lid hold", "on", on)
}
