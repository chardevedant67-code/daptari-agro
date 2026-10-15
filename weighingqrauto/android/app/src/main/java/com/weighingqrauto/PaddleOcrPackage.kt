package com.weighingqrauto

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

// Registers the on-device seven-segment reader (LiveWeightModule), which the
// "Scan Scale Display" photo flow uses to find and cross-check the display
// (aiWeightRead.js). The PaddleOCR module that used to be registered here
// was removed with the "Test PaddleOCR" button; the class keeps its name so
// MainApplication needs no change.
class PaddleOcrPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
      listOf(LiveWeightModule(reactContext))

  override fun createViewManagers(
      reactContext: ReactApplicationContext
  ): List<ViewManager<*, *>> = emptyList()
}
