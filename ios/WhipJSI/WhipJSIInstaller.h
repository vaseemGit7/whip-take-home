#pragma once
#import <React/RCTBridgeModule.h>

// Stub module whose sole purpose is to keep the linker from stripping the
// WhipJSIInstall category (defined in WhipJSIInstaller.mm) that hooks
// RCTDefaultReactNativeFactoryDelegate's host:didInitializeRuntime:.
@interface WhipJSIInstaller : NSObject <RCTBridgeModule>
@end
