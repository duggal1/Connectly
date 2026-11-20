//go:build darwin && cgo
#import <Foundation/Foundation.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <CoreGraphics/CoreGraphics.h>

CGImageRef connectly_capture_screen(void) {
    @autoreleasepool {
        if (@available(macOS 14.0, *)) {
            dispatch_semaphore_t done = dispatch_semaphore_create(0);
            __block CGImageRef result = NULL;
            [SCShareableContent getShareableContentExcludingDesktopWindows:NO onScreenWindowsOnly:YES completionHandler:^(SCShareableContent *content, NSError *error) {
                SCDisplay *display = nil;
                for (SCDisplay *candidate in content.displays) {
                    if (candidate.displayID == CGMainDisplayID()) { display = candidate; break; }
                }
                if (!display || error || !content) { dispatch_semaphore_signal(done); return; }
                SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:display excludingWindows:@[]];
                SCStreamConfiguration *config = [[SCStreamConfiguration alloc] init];
                config.width = display.width;
                config.height = display.height;
                config.showsCursor = YES;
                [SCScreenshotManager captureImageWithFilter:filter configuration:config completionHandler:^(CGImageRef image, NSError *captureError) {
                    if (image && !captureError) result = CGImageRetain(image);
                    [filter release];
                    [config release];
                    dispatch_semaphore_signal(done);
                }];
            }];
            dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
            return result;
        }
        return NULL;
    }
}
