package main

import (
	"os/exec"
	"path/filepath"
	"testing"
)

func TestTmuxCreateAndList(t *testing.T) {
	bin, err := exec.LookPath("tmux")
	if err != nil {
		t.Skip("tmux is not installed")
	}
	tmux := &Tmux{bin: bin, sock: filepath.Join(t.TempDir(), "tmux.sock")}
	t.Cleanup(func() { _, _ = tmux.run("kill-server") })
	if err := tmux.ensure(); err != nil {
		t.Fatal(err)
	}
	first, name, err := tmux.create("Shell", "", "", 80, 24)
	if err != nil || !validTmuxSessionID(first) || name != "Shell" {
		t.Fatalf("create: id=%q name=%q err=%v", first, name, err)
	}
	second, secondName, err := tmux.create("Shell", "", "", 80, 24)
	if err != nil || !validTmuxSessionID(second) || second == first || secondName != "Shell-2" {
		t.Fatalf("duplicate: id=%q name=%q err=%v", second, secondName, err)
	}
	if visible, err := tmux.visibleSession(first); err != nil || !visible {
		t.Fatalf("created session not visible: visible=%v err=%v", visible, err)
	}
	if err := tmux.kill(first); err != nil {
		t.Fatal(err)
	}
	if visible, _ := tmux.visibleSession(first); visible {
		t.Fatal("killed session is still visible")
	}
}
