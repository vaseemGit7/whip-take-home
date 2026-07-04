cmake_minimum_required(VERSION 3.13)
project(WhipJSI)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ReactAndroid prefab (shipped with the RN Gradle plugin) exposes:
#   ReactAndroid::jsi  — JSI runtime headers + libjsi.so
# This is the standard way to consume JSI in RN 0.76+ New Architecture.
find_package(ReactAndroid REQUIRED CONFIG)

add_library(
    whipjsi   # becomes libwhipjsi.so
    SHARED
    WhipStorageHostObject.cpp
)

target_include_directories(whipjsi PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}"
)

target_link_libraries(whipjsi
    ReactAndroid::jsi   # JSI headers and runtime symbols
    android             # Android NDK logging
    log
)
