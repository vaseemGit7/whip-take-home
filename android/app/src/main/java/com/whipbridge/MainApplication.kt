package com.whipbridge

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.bridge.ReactContext
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.whipbridge.jsi.WhipJSIInstaller
import com.whipbridge.modules.WhipMetricsPackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(WhipMetricsPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()

    // Register the JSI installer before loadReactNative() so it fires
    // as soon as the React context is ready.
    //
    // ReactInstanceEventListener.onReactContextInitialized fires on the JS
    // thread — the only thread allowed to access the JSI Runtime.
    // javaScriptContextHolder.get() returns the raw Runtime* pointer as a Long,
    // which we pass directly to our JNI function.
    reactHost.addReactInstanceEventListener(object : ReactInstanceEventListener {
      override fun onReactContextInitialized(context: ReactContext) {
        val holder = context.javaScriptContextHolder ?: return
        val ptr = holder.get()
        if (ptr != 0L) {
          WhipJSIInstaller.install(ptr)
        }
      }
    })

    loadReactNative(this)
  }
}
