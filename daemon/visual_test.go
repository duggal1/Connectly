package main

import (
	"testing"
	"time"
)

func TestVisualTicketRedeemsOnce(t *testing.T) {
	visual := newVisual(time.Minute)
	visual.on = true
	visual.tickets["one-time"] = time.Now().Add(time.Minute)
	if !visual.redeem("one-time") {
		t.Fatal("valid ticket should redeem")
	}
	if visual.redeem("one-time") {
		t.Fatal("ticket should not redeem twice")
	}
}

func TestVisualStopRevokesTickets(t *testing.T) {
	visual := newVisual(time.Minute)
	visual.on = true
	visual.tickets["pending"] = time.Now().Add(time.Minute)
	visual.Stop()
	if visual.redeem("pending") {
		t.Fatal("stopped share should revoke outstanding tickets")
	}
	if active, _ := visual.Status(); active {
		t.Fatal("stopped share should not be active")
	}
}
