package main

// ring keeps the last N bytes of PTY output and counts every byte ever written.
// The running total is the offset clients use to resume without a full replay.
type ring struct {
	buf   []byte
	start int
	n     int
	total uint64
}

func newRing(capacity int) *ring {
	if capacity < 1 {
		capacity = 1
	}
	return &ring{buf: make([]byte, capacity)}
}

func (r *ring) write(p []byte) {
	r.total += uint64(len(p))
	c := len(r.buf)
	if len(p) >= c {
		copy(r.buf, p[len(p)-c:])
		r.start, r.n = 0, c
		return
	}
	end := (r.start + r.n) % c
	first := copy(r.buf[end:], p)
	copy(r.buf, p[first:])
	r.n += len(p)
	if r.n > c {
		r.start = (r.start + r.n - c) % c
		r.n = c
	}
}

func (r *ring) snapshot() []byte {
	c := len(r.buf)
	out := make([]byte, r.n)
	endFirst := r.start + r.n
	if endFirst > c {
		endFirst = c
	}
	first := copy(out, r.buf[r.start:endFirst])
	copy(out[first:], r.buf[:r.n-first])
	return out
}

// since returns missing bytes, their absolute base offset, and whether the
// client must reset because its offset is unavailable or outside the ring.
func (r *ring) since(from uint64, allow bool) ([]byte, uint64, bool) {
	snap := r.snapshot()
	oldest := r.total - uint64(r.n)
	if !allow || from < oldest || from > r.total {
		return snap, oldest, true
	}
	return snap[int(from-oldest):], from, false
}
