package main

import (
	"testing"
	"time"
)

func TestHasAgentError(t *testing.T) {
	for _, output := range []string{
		"Error: authentication failed",
		"Request failed with status 503",
		"panic: unexpected state",
	} {
		if !hasAgentError(output) {
			t.Errorf("expected error in %q", output)
		}
	}
	for _, output := range []string{
		"No errors found.",
		"0 errors",
		"Waiting for the next task.",
	} {
		if hasAgentError(output) {
			t.Errorf("unexpected error in %q", output)
		}
	}
}

func TestClassifyRemoteSessionUsesObservedOutput(t *testing.T) {
	now := time.Now()
	if got := classifyRemoteSession(false, &observedSession{changed: now.Add(-time.Hour)}, now); got != "idle" {
		t.Fatalf("newly opened agent should be idle until output changes, got %q", got)
	}
	if got := classifyRemoteSession(false, &observedSession{changed: now.Add(-time.Second), hasOutput: true}, now); got != "running" {
		t.Fatalf("recent output should be running, got %q", got)
	}
	if got := classifyRemoteSession(false, &observedSession{changed: now.Add(-time.Second), error: true, hasOutput: true}, now); got != "error" {
		t.Fatalf("agent error should take precedence, got %q", got)
	}
	if got := classifyRemoteSession(true, &observedSession{changed: now, error: true, hasOutput: true}, now); got != "shell" {
		t.Fatalf("shell prompt should remain a prompt, got %q", got)
	}
}

func TestFocusLooseRejectsInvalidIdentityBeforeProcessLookup(t *testing.T) {
	remote := &Remote{}
	if err := remote.focusLoose(1, time.Now().Unix()); err == nil {
		t.Fatal("expected invalid pid to be rejected")
	}
	if err := remote.focusLoose(999999, 0); err == nil {
		t.Fatal("expected invalid start time to be rejected")
	}
}
