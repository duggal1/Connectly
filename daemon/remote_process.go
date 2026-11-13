package main

import (
	"context"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode"
)

type processInfo struct {
	uid, pid, ppid int
	cpu            float64
	tty            string
	startedAt      int64
	args           string
}

var shellNames = map[string]bool{"sh": true, "bash": true, "zsh": true, "fish": true, "dash": true, "ksh": true, "tcsh": true, "csh": true, "nu": true}

func readProcesses() (map[int]*processInfo, map[int][]int) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, "/bin/ps", "-ww", "-axo", "uid=,pid=,ppid=,pcpu=,tty=,lstart=,command=").Output()
	if err != nil {
		return map[int]*processInfo{}, map[int][]int{}
	}
	processes := make(map[int]*processInfo)
	children := make(map[int][]int)
	for _, line := range strings.Split(string(output), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 11 {
			continue
		}
		uid, uidErr := strconv.Atoi(fields[0])
		pid, pidErr := strconv.Atoi(fields[1])
		ppid, ppidErr := strconv.Atoi(fields[2])
		if uidErr != nil || pidErr != nil || ppidErr != nil {
			continue
		}
		cpu, _ := strconv.ParseFloat(fields[3], 64)
		startedAt := parseStartTime(strings.Join(fields[5:10], " "))
		process := &processInfo{
			uid: uid, pid: pid, ppid: ppid, cpu: cpu, tty: fields[4],
			startedAt: startedAt, args: restAfter(line, 10),
		}
		processes[pid] = process
		children[ppid] = append(children[ppid], pid)
	}
	return processes, children
}

func restAfter(line string, count int) string {
	index := 0
	for field := 0; field < count; field++ {
		for index < len(line) && (line[index] == ' ' || line[index] == '\t') {
			index++
		}
		for index < len(line) && line[index] != ' ' && line[index] != '\t' {
			index++
		}
	}
	return strings.TrimSpace(line[index:])
}

func parseStartTime(value string) int64 {
	for _, layout := range []string{"Mon Jan _2 15:04:05 2006", "Mon Jan 2 15:04:05 2006"} {
		if parsed, err := time.ParseInLocation(layout, value, time.Local); err == nil {
			return parsed.Unix()
		}
	}
	return 0
}

func descendProcesses(root int, children map[int][]int) []int {
	result := make([]int, 0)
	queue := append([]int(nil), children[root]...)
	for len(queue) > 0 && len(result) < 512 {
		pid := queue[0]
		queue = queue[1:]
		result = append(result, pid)
		queue = append(queue, children[pid]...)
	}
	return result
}

func currentDirectory(pid int) string {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, "/usr/sbin/lsof", "-a", "-p", strconv.Itoa(pid), "-d", "cwd", "-Fn").Output()
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(output), "\n") {
		if strings.HasPrefix(line, "n") {
			return line[1:]
		}
	}
	return ""
}

func lastUsefulLine(output string) string {
	lines := strings.Split(output, "\n")
	for index := len(lines) - 1; index >= 0; index-- {
		line := strings.TrimSpace(lines[index])
		letters := 0
		for _, char := range line {
			if unicode.IsLetter(char) {
				letters++
			}
		}
		if letters >= 4 {
			runes := []rune(line)
			if len(runes) > 140 {
				runes = runes[:140]
			}
			return string(runes)
		}
	}
	return ""
}

func agentOf(command string) string {
	fields := strings.Fields(command)
	if len(fields) == 0 {
		return ""
	}
	candidate := fields[0]
	switch filepath.Base(candidate) {
	case "node", "bun", "deno", "python", "python3", "npx":
		for _, field := range fields[1:] {
			if !strings.HasPrefix(field, "-") {
				candidate = field
				break
			}
		}
	}
	lower := strings.ToLower(candidate)
	base := filepath.Base(lower)
	switch {
	case strings.Contains(lower, "@anthropic-ai/claude-code"), base == "claude", strings.Contains(lower, "/claude/versions/"):
		return "claude"
	case strings.Contains(lower, "@openai/codex"), base == "codex":
		return "codex"
	case base == "opencode", strings.Contains(lower, "opencode-ai"):
		return "opencode"
	case strings.Contains(lower, "@google/gemini-cli"), base == "gemini":
		return "gemini"
	case base == "aider":
		return "aider"
	default:
		return ""
	}
}
