#import "WhipJSIInstaller.h"

// JSI installation is now handled by WhipRNDelegate in the main app target,
// which overrides host:didInitializeRuntime: directly on the concrete delegate
// class. This stub keeps the pod compiling and the static library present so
// the linker includes WhipStorageHostObject from the same .a archive.
@implementation WhipJSIInstaller
RCT_EXPORT_MODULE_NO_LOAD(WhipJSIInstaller, WhipJSIInstaller)
+ (BOOL)requiresMainQueueSetup { return NO; }
@end
