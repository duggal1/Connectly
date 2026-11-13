package main

import (
	"hash/fnv"
	"os"
	"sort"
	"strings"
	"time"
)

func (r *Remote) list() (RemoteSnapshot, error) {
	if err := r.refresh(); err != nil {
		return RemoteSnapshot{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.last, nil
}

func (r *Remote) refresh() error {
	r.pollMu.Lock()
	defer r.pollMu.Unlock()
	if err := r.ensure(); err != nil {
		r.mu.Lock()
		r.ready = false
		r.mu.Unlock()
		return err
	}
	rows, err := r.tmux.panes()
	if err != nil {
		r.mu.Lock()
		r.ready = false
		r.mu.Unlock()
		return err
	}
	procs, children := readProcesses()
	now := time.Now()
	phones := r.phoneCounts()

	type group struct {
		remote   RemoteSessionInfo
		primary  *tmuxPane
		pids     []int
		activity int64
		attached int
	}
	groups := make(map[string]*group)
	order := make([]string, 0)
	for index := range rows {
		pane := &rows[index]
		if strings.HasPrefix(pane.Name, "_") {
			continue
		}
		g := groups[pane.SessionID]
		if g == nil {
			g = &group{remote: RemoteSessionInfo{ID: pane.SessionID, Name: pane.Name, CreatedAt: pane.Created * 1000, Windows: pane.Windows}}
			groups[pane.SessionID] = g
			order = append(order, pane.SessionID)
		}
		g.remote.Panes++
		g.pids = append(g.pids, pane.PID)
		g.attached = pane.Attached
		if pane.Activity > g.activity {
			g.activity = pane.Activity
		}
		if g.primary == nil || (pane.WindowOn && pane.PaneOn) {
			g.primary = pane
		}
	}

	managed := make(map[int]bool)
	alive := make(map[string]bool, len(groups))
	sessions := make([]RemoteSessionInfo, 0, len(groups))
	anyRunning := false
	phoneTotal := 0
	captures := 0
	for _, id := range order {
		g := groups[id]
		pane := g.primary
		if pane == nil {
			continue
		}
		alive[id] = true
		agent := ""
		for _, pid := range append([]int{pane.PID}, g.pids...) {
			managed[pid] = true
			for _, child := range descendProcesses(pid, children) {
				managed[child] = true
				if agent == "" {
					if process := procs[child]; process != nil {
						agent = agentOf(process.args)
					}
				}
			}
		}
		command := strings.TrimPrefix(pane.Command, "-")
		isShell := agent == "" && shellNames[command]
		observed := r.sessionObservation(id, g.activity, now)
		if (!isShell || observed.preview == "") && captures < 24 {
			captures++
			if captured, captureErr := r.tmux.capture(id); captureErr == nil {
				hash := fnv.New64a()
				_, _ = hash.Write([]byte(captured))
				sum := hash.Sum64()
				if observed.hash != 0 && sum != observed.hash && !isShell {
					observed.changed = now
				}
				observed.hash = sum
				observed.preview = lastUsefulLine(captured)
			}
		}
		state := "shell"
		if !isShell {
			if now.Sub(observed.changed) < 4*time.Second {
				state = "running"
				anyRunning = true
			} else {
				state = "idle"
			}
		}
		phoneCount := phones[id]
		phoneTotal += phoneCount
		g.remote.Phones = phoneCount
		g.remote.MacClients = max(0, g.attached-phoneCount)
		g.remote.LastActive = observed.changed.UnixMilli()
		g.remote.Cols, g.remote.Rows = pane.Cols, pane.Rows
		g.remote.Command, g.remote.Agent = command, agent
		g.remote.State, g.remote.Title, g.remote.Cwd = state, pane.Title, pane.Path
		g.remote.Preview = observed.preview
		sessions = append(sessions, g.remote)
	}

	r.mu.Lock()
	for id := range r.seen {
		if !alive[id] {
			delete(r.seen, id)
		}
	}
	r.mu.Unlock()
	loose := r.looseAgents(procs, managed)
	for _, session := range sessions {
		if session.State == "running" {
			anyRunning = true
		}
	}
	for _, agent := range loose {
		if agent.State == "running" {
			anyRunning = true
		}
	}
	r.wake.SetReason("remote", anyRunning || phoneTotal > 0)
	sort.Slice(sessions, func(i, j int) bool {
		if sessions[i].CreatedAt != sessions[j].CreatedAt {
			return sessions[i].CreatedAt < sessions[j].CreatedAt
		}
		return sessions[i].Name < sessions[j].Name
	})
	snapshot := RemoteSnapshot{Type: "sessions", At: now.UnixMilli(), Host: r.host, Sessions: sessions, Loose: loose}
	r.mu.Lock()
	r.last = snapshot
	r.mu.Unlock()
	return nil
}

func (r *Remote) phoneCounts() map[string]int {
	r.mu.Lock()
	defer r.mu.Unlock()
	copy := make(map[string]int, len(r.phones))
	for id, count := range r.phones {
		copy[id] = count
	}
	return copy
}

func (r *Remote) sessionObservation(id string, activity int64, now time.Time) *observedSession {
	r.mu.Lock()
	defer r.mu.Unlock()
	state := r.seen[id]
	if state == nil {
		state = &observedSession{activity: activity, changed: time.Unix(activity, 0)}
		r.seen[id] = state
	} else if state.activity != activity {
		state.activity = activity
		state.changed = now
	}
	return state
}

func (r *Remote) looseAgents(procs map[int]*processInfo, managed map[int]bool) []LooseAgent {
	loose := make([]LooseAgent, 0)
	seen := make(map[int]bool)
	uid := os.Getuid()
	for pid, process := range procs {
		if managed[pid] || process.uid != uid || process.startedAt <= 0 || process.tty == "??" || process.tty == "?" || process.tty == "" {
			continue
		}
		agent := agentOf(process.args)
		if agent == "" {
			continue
		}
		if parent := procs[process.ppid]; parent != nil && agentOf(parent.args) == agent {
			continue
		}
		seen[pid] = true
		meta, exists := r.meta[pid]
		if !exists || meta.startedAt != process.startedAt || meta.command != process.args {
			meta = observedProcess{startedAt: process.startedAt, command: process.args, cwd: currentDirectory(pid)}
			r.meta[pid] = meta
		}
		state := "idle"
		if process.cpu >= 2 {
			state = "running"
		}
		loose = append(loose, LooseAgent{PID: pid, Agent: agent, TTY: process.tty, Cwd: meta.cwd, StartedAt: process.startedAt, State: state})
	}
	for pid := range r.meta {
		if !seen[pid] {
			delete(r.meta, pid)
		}
	}
	sort.Slice(loose, func(i, j int) bool { return loose[i].StartedAt < loose[j].StartedAt })
	return loose
}

func (r *Remote) listSessions() (RemoteSnapshot, error) { return r.list() }
