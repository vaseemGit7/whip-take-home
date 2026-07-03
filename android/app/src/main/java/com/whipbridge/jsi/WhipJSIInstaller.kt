package com.whipbridge.jsi

// WhipJSIInstaller loads libwhipjsi.so (compiled from WhipStorageHostObject.cpp)
// and exposes a single JNI method: install(runtimePointer: Long).
//
// The runtimePointer is obtained from ReactContext.javaScriptContextHolder.get()
// inside a ReactInstanceEventListener, which fires on the JS thread — the only
// safe thread from which to access the JSI Runtime.
object WhipJSIInstaller {
    init {
        System.loadLibrary("whipjsi")
    }

    // Installs global.__whipStorage into the Hermes runtime.
    // Must be called from the JS thread (inside ReactInstanceEventListener).
    @JvmStatic
    external fun install(runtimePointer: Long)
}
