#pragma once
#import <React/RCTBridgeModule.h>

// WhipJSIInstaller self-registers as an RCT module via RCT_EXPORT_MODULE().
// The bridge calls setBridge: automatically at startup — no AppDelegate wiring needed.
// On notification that the JS bundle has loaded, it dispatches to the JS thread
// and installs the WhipStorageHostObject into the JSI runtime.
@interface WhipJSIInstaller : NSObject <RCTBridgeModule>
@end
