package main

import (
	"sync"
	"time"
)

const (
	maxFails   = 5
	lockoutFor = 5 * time.Minute
)

type lim struct {
	fails int
	until time.Time
}

type limiter struct {
	mu sync.Mutex
	m  map[string]*lim
}

func newLimiter() *limiter { return &limiter{m: map[string]*lim{}} }

func (l *limiter) blocked(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	e := l.m[ip]
	return e != nil && time.Now().Before(e.until)
}

func (l *limiter) fail(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	e := l.m[ip]
	if e == nil {
		e = &lim{}
		l.m[ip] = e
	}
	e.fails++
	if e.fails >= maxFails {
		e.until = time.Now().Add(lockoutFor)
		e.fails = 0
	}
}

func (l *limiter) ok(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.m, ip)
}