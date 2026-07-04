#pragma once
#include <jsi/jsi.h>
#include <memory>
#include <string>
#include <unordered_map>

namespace whip {

// Shared HostObject implementation — identical logic to the iOS version.
// The C++ core is platform-agnostic; only the JNI entry point below is Android-specific.
class WhipStorageHostObject
    : public facebook::jsi::HostObject,
      public std::enable_shared_from_this<WhipStorageHostObject> {
 public:
  WhipStorageHostObject();

  facebook::jsi::Value get(facebook::jsi::Runtime& rt,
                           const facebook::jsi::PropNameID& name) override;

  void set(facebook::jsi::Runtime& rt,
           const facebook::jsi::PropNameID& name,
           const facebook::jsi::Value& value) override {}

  std::vector<facebook::jsi::PropNameID> getPropertyNames(
      facebook::jsi::Runtime& rt) override;

  static void install(facebook::jsi::Runtime& rt);

 private:
  std::unordered_map<std::string, std::string> store_;
};

}  // namespace whip
