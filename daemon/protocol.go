package main

import (
	"encoding/binary"
	"encoding/json"
	"errors"
)

// Frame: [1-byte type][4-byte big-endian length][payload]
const (
	TStdin     byte = 0x01
	TStdout    byte = 0x02
	TStderr    byte = 0x03 // reserved. A PTY merges stderr into stdout.
	TResize    byte = 0x04 // cols u16, rows u16 (big-endian)
	TControl   byte = 0x05 // JSON
	THeartbeat byte = 0x06 // echoed verbatim

	maxPayload = 1 << 20
)

var errFrame = errors.New("bad frame")

func encode(t byte, payload []byte) []byte {
	b := make([]byte, 5+len(payload))
	b[0] = t
	binary.BigEndian.PutUint32(b[1:5], uint32(len(payload)))
	copy(b[5:], payload)
	return b
}

func decode(b []byte) (byte, []byte, error) {
	if len(b) < 5 {
		return 0, nil, errFrame
	}
	n := binary.BigEndian.Uint32(b[1:5])
	if int(n) != len(b)-5 || n > maxPayload {
		return 0, nil, errFrame
	}
	return b[0], b[5:], nil
}

func controlFrame(v map[string]any) []byte {
	j, _ := json.Marshal(v)
	return encode(TControl, j)
}