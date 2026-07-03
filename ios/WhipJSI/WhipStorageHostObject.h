#pragma once
#include <jsi/jsi.h>
#include <memory>
#include <string>
#include <unordered_map>

namespace whip {

// A JSI HostObject that exposes a single synchronous method — getSync(key) —
// to the Hermes runtime. HostObject::get() is called by Hermes when JS reads a
// property off the object (e.g. storage.getSync), so we return a Function for
// the "getSync" property and undefined for everything else.
//
// Note: this object lives in the Hermes runtime (RN JS thread). WebView JS
// contexts are isolated from Hermes by design, so mini apps cannot call this
// directly. The benefit is on the HOST side: BridgeHost can call getSync()
// instead of awaiting AsyncStorage — eliminating the async hop.
class WhipStorageHostObject
    : public facebook::jsi::HostObject,
      public std::enable_shared_from_this<WhipStorageHostObject> {
 public:
  WhipStorageHostObject();

  facebook::jsi::Value get(facebook::jsi::Runtime& rt,
                           const facebook::jsi::PropNameID& name) override;

  // Read-only from JS — set is a no-op.
  void set(facebook::jsi::Runtime& rt,
           const facebook::jsi::PropNameID& name,
           const facebook::jsi::Value& value) override {}

  std::vector<facebook::jsi::PropNameID> getPropertyNames(
      facebook::jsi::Runtime& rt) override;

  // Install this HostObject as global.__whipStorage in the given runtime.
  static void install(facebook::jsi::Runtime& rt);

 private:
  // In-memory store. In production this would delegate to MMKV or
  // NSUserDefaults (iOS) / SharedPreferences (Android) for durability.
  std::unordered_map<std::string, std::string> store_;
};

}  // namespace whip
