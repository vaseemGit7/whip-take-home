#import "WhipRNDelegate.h"
#import "RCTReactNativeFactory.h"
#import <React/RCTBundleURLProvider.h>

@class RCTHost;

#include "../WhipJSI/WhipStorageHostObject.h"

// ------------------------------------------------------------------
// Root cause: RCTReactNativeFactory is the actual hostDelegate stored
// on RCTHost — not WhipRNDelegate. The factory does NOT implement
// host:didInitializeRuntime:, so RCTHost's respondsToSelector: check
// returns NO and the call is silently dropped.
//
// This category adds the method to RCTReactNativeFactory itself.
// Now respondsToSelector: returns YES and RCTHost calls our impl
// before the JS bundle executes.
// ------------------------------------------------------------------
@implementation RCTReactNativeFactory (WhipJSIInstall)

- (void)host:(RCTHost *)host didInitializeRuntime:(facebook::jsi::Runtime &)runtime {
  whip::WhipStorageHostObject::install(runtime);
}

@end

// ------------------------------------------------------------------
// WhipRNDelegate remains in case the delegate chain ever changes.
// ------------------------------------------------------------------
@implementation WhipRNDelegate

- (NSURL *)bundleURL {
#ifdef DEBUG
  return [RCTBundleURLProvider.sharedSettings jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

@end
