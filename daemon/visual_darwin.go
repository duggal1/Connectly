//go:build darwin && cgo

package main

/*
#cgo LDFLAGS: -framework ApplicationServices -framework CoreGraphics -framework ImageIO -framework CoreFoundation -framework Foundation -framework ScreenCaptureKit
#include <ApplicationServices/ApplicationServices.h>
#include <ImageIO/ImageIO.h>
#include <CoreFoundation/CoreFoundation.h>
#include <stdlib.h>

static int can_capture(void) { return CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess(); }
static int can_control(void) {
    const void *keys[] = { kAXTrustedCheckOptionPrompt };
    const void *values[] = { kCFBooleanTrue };
    CFDictionaryRef options = CFDictionaryCreate(NULL, keys, values, 1, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    int trusted = AXIsProcessTrustedWithOptions(options);
    CFRelease(options);
    return trusted;
}
extern CGImageRef connectly_capture_screen(void);
static CFDataRef capture_screen(void) {
    CGImageRef image = connectly_capture_screen();
    if (!image) return NULL;
    CFMutableDataRef data = CFDataCreateMutable(NULL, 0);
    CGImageDestinationRef dest = CGImageDestinationCreateWithData(data, CFSTR("public.jpeg"), 1, NULL);
    if (!dest) { CFRelease(data); CGImageRelease(image); return NULL; }
    double quality = 0.65;
    CFNumberRef number = CFNumberCreate(NULL, kCFNumberDoubleType, &quality);
    const void *keys[] = { kCGImageDestinationLossyCompressionQuality };
    const void *values[] = { number };
    CFDictionaryRef options = CFDictionaryCreate(NULL, keys, values, 1, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CGImageDestinationAddImage(dest, image, options);
    bool ok = CGImageDestinationFinalize(dest);
    CFRelease(options); CFRelease(number); CFRelease(dest); CGImageRelease(image);
    if (!ok) { CFRelease(data); return NULL; }
    return data;
}
static long data_length(CFDataRef data) { return CFDataGetLength(data); }
static const UInt8 *data_bytes(CFDataRef data) { return CFDataGetBytePtr(data); }
static void release_data(CFDataRef data) { CFRelease(data); }
static void pointer_event(double x, double y, int kind) {
    CGRect bounds = CGDisplayBounds(CGMainDisplayID());
    CGPoint point = CGPointMake(bounds.origin.x + x * bounds.size.width, bounds.origin.y + y * bounds.size.height);
    CGEventType type = kCGEventMouseMoved;
    if (kind == 1) type = kCGEventLeftMouseDown;
    else if (kind == 2) type = kCGEventLeftMouseUp;
    else if (kind == 3) type = kCGEventLeftMouseDragged;
    CGEventRef event = CGEventCreateMouseEvent(NULL, type, point, kCGMouseButtonLeft);
    if (event) { CGEventPost(kCGHIDEventTap, event); CFRelease(event); }
}
static void scroll_event(double deltaY) {
    int32_t lines = (int32_t)(-deltaY);
    CGEventRef event = CGEventCreateScrollWheelEvent(NULL, kCGScrollEventUnitLine, 1, lines);
    if (event) { CGEventPost(kCGHIDEventTap, event); CFRelease(event); }
}
static void keyboard_text(const UniChar *text, int length) {
    CGEventRef down = CGEventCreateKeyboardEvent(NULL, 0, true);
    CGEventRef up = CGEventCreateKeyboardEvent(NULL, 0, false);
    if (down && up) {
        CGEventKeyboardSetUnicodeString(down, length, text);
        CGEventKeyboardSetUnicodeString(up, length, text);
        CGEventPost(kCGHIDEventTap, down);
        CGEventPost(kCGHIDEventTap, up);
    }
    if (down) CFRelease(down);
    if (up) CFRelease(up);
}
static void keyboard_key(int key) {
    CGEventRef down = CGEventCreateKeyboardEvent(NULL, key, true);
    CGEventRef up = CGEventCreateKeyboardEvent(NULL, key, false);
    if (down && up) { CGEventPost(kCGHIDEventTap, down); CGEventPost(kCGHIDEventTap, up); }
    if (down) CFRelease(down);
    if (up) CFRelease(up);
}
*/
import "C"

import (
	"errors"
	"unicode/utf16"
	"unsafe"
)

func visualPermission() error {
	if C.can_capture() == 0 {
		return errors.New("Allow Screen Recording for termd in macOS System Settings, then retry.")
	}
	return nil
}

func visualFrame() ([]byte, error) {
	data := C.capture_screen()
	if data == 0 {
		return nil, errors.New("Could not capture the Mac screen.")
	}
	defer C.release_data(data)
	return C.GoBytes(unsafe.Pointer(C.data_bytes(data)), C.int(C.data_length(data))), nil
}

func visualPointer(x, y float64, kind int) bool {
	if C.can_control() == 0 {
		return false
	}
	C.pointer_event(C.double(x), C.double(y), C.int(kind))
	return true
}

func visualScroll(deltaY float64) bool {
	if C.can_control() == 0 {
		return false
	}
	C.scroll_event(C.double(deltaY))
	return true
}

func visualType(text, key string) bool {
	if C.can_control() == 0 {
		return false
	}
	keys := map[string]C.int{"Enter": 36, "Backspace": 51, "Tab": 48, "Escape": 53, "ArrowLeft": 123, "ArrowRight": 124, "ArrowDown": 125, "ArrowUp": 126}
	if code, ok := keys[key]; ok {
		C.keyboard_key(code)
	} else if text != "" {
		units := utf16.Encode([]rune(text))
		C.keyboard_text((*C.UniChar)(unsafe.Pointer(&units[0])), C.int(len(units)))
	}
	return true
}
