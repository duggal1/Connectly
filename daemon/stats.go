package main

import (
	"context"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Stats struct {
	Op        string  `json:"op,omitempty"`
	Battery   *int    `json:"battery"`
	Charging  bool    `json:"charging"`
	Source    string  `json:"source"`
	Remaining *int    `json:"remaining"`
	LidClosed *bool   `json:"lidClosed"`
	Load1     float64 `json:"load1"`
	At        int64   `json:"at"`
}

var (
	rePct  = regexp.MustCompile(`(\d+)%`)
	reRem  = regexp.MustCompile(`(\d+):(\d+) remaining`)
	reClam = regexp.MustCompile(`"AppleClamshellState"\s*=\s*(Yes|No)`)
)

func run(name string, args ...string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, name, args...).Output()
	if err != nil {
		return ""
	}
	return string(out)
}

func parseBatt(out string, st *Stats) {
	if out == "" {
		return
	}
	lines := strings.Split(out, "\n")
	if strings.Contains(lines[0], "Battery Power") {
		st.Source = "battery"
	}
	for _, ln := range lines[1:] {
		m := rePct.FindStringSubmatch(ln)
		if m == nil {
			continue
		}
		p, _ := strconv.Atoi(m[1])
		st.Battery = &p
		low := strings.ToLower(ln)
		st.Charging = (strings.Contains(low, "charging") &&
			!strings.Contains(low, "discharging") &&
			!strings.Contains(low, "not charging")) ||
			strings.Contains(low, "finishing charge")
		if r := reRem.FindStringSubmatch(ln); r != nil {
			h, _ := strconv.Atoi(r[1])
			mi, _ := strconv.Atoi(r[2])
			if t := h*60 + mi; t > 0 {
				st.Remaining = &t
			}
		}
		return
	}
}

func readStats() Stats {
	st := Stats{Source: "ac", At: time.Now().UnixMilli()}
	parseBatt(run("/usr/bin/pmset", "-g", "batt"), &st)
	if m := reClam.FindStringSubmatch(run("/usr/sbin/ioreg", "-r", "-k", "AppleClamshellState", "-d", "1")); m != nil {
		closed := m[1] == "Yes"
		st.LidClosed = &closed
	}
	if f := strings.Fields(strings.Trim(run("/usr/sbin/sysctl", "-n", "vm.loadavg"), "{} \n")); len(f) > 0 {
		st.Load1, _ = strconv.ParseFloat(f[0], 64)
	}
	return st
}

// StatsSource caches for two seconds so clients do not repeatedly invoke pmset.
type StatsSource struct {
	mu   sync.Mutex
	last Stats
	at   time.Time
}

func (s *StatsSource) Get() Stats {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.at.IsZero() && time.Since(s.at) < 2*time.Second {
		return s.last
	}
	s.last = readStats()
	s.at = time.Now()
	return s.last
}
