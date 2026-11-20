package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

const focusGhosttyScript = `on run argv
set targetTTY to item 1 of argv
tell application "Ghostty"
  repeat with w in windows
    repeat with tabItem in tabs of w
      repeat with terminalItem in terminals of tabItem
        if (tty of terminalItem as text) ends with targetTTY then
          focus terminalItem
          activate
          return "ok"
        end if
      end repeat
    end repeat
  end repeat
end tell
return "not found"
end run`

const focusTerminalScript = `on run argv
set targetTTY to item 1 of argv
tell application "Terminal"
  repeat with w in windows
    repeat with t in tabs of w
      if (tty of t as text) ends with targetTTY then
        set selected of t to true
        set index of w to 1
        activate
        return "ok"
      end if
    end repeat
  end repeat
end tell
return "not found"
end run`

const focusITermScript = `on run argv
set targetTTY to item 1 of argv
tell application "iTerm2"
  repeat with w in windows
    repeat with tabItem in tabs of w
      repeat with sessionItem in sessions of tabItem
        if (tty of sessionItem as text) ends with targetTTY then
          select tabItem
          select sessionItem
          select w
          activate
          return "ok"
        end if
      end repeat
    end repeat
  end repeat
end tell
return "not found"
end run`

func (r *Remote) focusLoose(pid int, startedAt int64) error {
	if pid <= 1 || startedAt <= 0 {
		return errors.New("invalid process identity")
	}
	processes, _ := readProcesses()
	process := processes[pid]
	if process == nil || process.uid != os.Getuid() || process.startedAt != startedAt || agentOf(process.args) == "" {
		return errors.New("That process is gone or changed.")
	}
	tty := strings.TrimPrefix(process.tty, "/dev/")
	if !strings.HasPrefix(tty, "ttys") || strings.ContainsAny(tty, "/\\ \t\r\n") {
		return errors.New("This process does not have a supported Mac terminal.")
	}
	var automationError string
	for _, app := range []struct{ process, script string }{
		{"Ghostty", focusGhosttyScript}, {"Terminal", focusTerminalScript}, {"iTerm2", focusITermScript},
	} {
		if exec.Command("/usr/bin/pgrep", "-x", app.process).Run() != nil {
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		output, err := exec.CommandContext(ctx, "/usr/bin/osascript", "-e", app.script, "--", tty).CombinedOutput()
		cancel()
		if err != nil {
			if automationError == "" {
				automationError = fmt.Sprintf("%s: %s", app.process, strings.TrimSpace(string(output)))
			}
			continue
		}
		if strings.TrimSpace(string(output)) == "ok" {
			return nil
		}
	}
	if automationError != "" {
		return fmt.Errorf("Could not focus the Mac terminal. Allow Automation access for termd in System Settings: %s", automationError)
	}
	return errors.New("Could not find this terminal in Ghostty, Terminal, or iTerm2. Open it on the Mac desktop.")
}
