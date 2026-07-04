cmake_minimum_required(VERSION 3.13)

# The library name must be "appmodules" — SoLoader.loadLibrary("appmodules") is
# hard-coded in libreactnative.so. ReactNative-application.cmake creates a shared
# library named ${CMAKE_PROJECT_NAME}, so we set the project name accordingly.
project(appmodules)

set(REACT_ANDROID_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../node_modules/react-native/ReactAndroid")
set(PROJECT_BUILD_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../build")

# ReactNative-application.cmake builds libappmodules.so with all the right
# production compile flags (Folly, -fexceptions, -frtti, tagged-pointer
# compat, ANDROID_STL=c++_shared, etc.) and wires in autolinking +
# app-level codegen automatically.
#
# Because there are no *.cpp files in this directory (WhipStorageHostObject.cpp
# lives in jsi/ below), the cmake will use the default OnLoad.cpp from the RN
# source tree — exactly what a vanilla RN 0.86 new-arch app uses.
include(${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)

# ── libwhipjsi.so ─────────────────────────────────────────────────────────────
# Separate library loaded by WhipJSIInstaller.kt at runtime.
# Installs global.__whipStorage as a JSI HostObject.
add_library(whipjsi SHARED jsi/WhipStorageHostObject.cpp)
target_include_directories(whipjsi PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/jsi")
target_link_libraries(whipjsi ReactAndroid::jsi android log)
