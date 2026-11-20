//go:build !darwin || !cgo

package main

import "errors"

func visualPermission() error                  { return errors.New("Screen viewing requires macOS with CGO enabled.") }
func visualFrame() ([]byte, error)             { return nil, errors.New("Screen viewing is unavailable.") }
func visualPointer(float64, float64, int) bool { return false }
func visualScroll(float64) bool                { return false }
func visualType(string, string) bool           { return false }
