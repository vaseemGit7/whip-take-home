#import "WhipJSIInstaller.h"

// RCTBridge+Private exposes RCTCxxBridge and the .runtime property (void*).
#import <React/RCTBridge+Private.h>
// RCTUtils.h defines RCTJSThread — the dispatch_queue_t for the JS thread.
#import <React/RCTUtils.h>

#include "WhipStorageHostObject.h"

using namespace facebook::jsi;

@implementation WhipJSIInstaller

// Self-registration: the bridge discovers all classes conforming to RCTBridgeModule
// at startup via __attribute__((constructor)) registration, so no Podfile or
// AppDelegate modification is needed beyond adding the pod.
RCT_EXPORT_MODULE(WhipJSIInstaller)

// Module initialization does not require the main queue (no UI work).
+ (BOOL)requiresMainQueueSetup {
  return NO;
}

// setBridge: is called by the bridge after module registration but BEFORE the JS
// bundle loads. We must not touch the JSI runtime here — it isn't ready yet.
// Instead, register for RCTJavaScriptDidLoadNotification and install on the JS
// thread once the bundle has loaded.
- (void)setBridge:(RCTBridge *)bridge {
  [super setBridge:bridge];

  __weak RCTBridge *weakBridge = bridge;

  [[NSNotificationCenter defaultCenter]
      addObserverForName:RCTJavaScriptDidLoadNotification
                  object:bridge  // scoped to this bridge instance only
                   queue:nil     // delivered on whichever thread posts it
              usingBlock:^(NSNotification * /*note*/) {
                RCTBridge *b = weakBridge;
                if (!b) {
                  return;
                }

                // Dispatch to the JS thread.
                // JSI::Runtime is single-threaded and must only be accessed from
                // the Hermes JS thread. RCTJSThread is the serial queue Hermes
                // uses — dispatching here is the correct and only safe approach.
                [b dispatchBlock:^{
                  RCTCxxBridge *cxxBridge = (RCTCxxBridge *)b;
                  if (!cxxBridge.runtime) {
                    return;
                  }
                  Runtime &rt = *(Runtime *)cxxBridge.runtime;
                  whip::WhipStorageHostObject::install(rt);
                }
                         queue:RCTJSThread];
              }];
}

@end
