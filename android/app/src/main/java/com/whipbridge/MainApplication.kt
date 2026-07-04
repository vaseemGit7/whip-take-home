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

    // loadReactNative initializes SoLoader — must run before reactHost is accessed.
    loadReactNative(this)

    // JSI install must happen on the JS thread. onReactContextInitialized fires on the
    // UI thread, so we post the actual install via runOnJSQueueThread.
    // javaScriptContextHolder is captured before posting — it remains valid for the
    // lifetime of the ReactInstance and is safe to read from any thread.
    reactHost.addReactInstanceEventListener(object : ReactInstanceEventListener {
      override fun onReactContextInitialized(context: ReactContext) {
        val holder = context.javaScriptContextHolder ?: return
        context.runOnJSQueueThread {
          val ptr = holder.get()
          if (ptr != 0L) {
            WhipJSIInstaller.install(ptr)
          }
        }
      }
    })
  }
}
