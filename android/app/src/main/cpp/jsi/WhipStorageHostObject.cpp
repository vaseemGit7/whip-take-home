#include "WhipStorageHostObject.h"
#include <jni.h>
#include <memory>

using namespace facebook::jsi;
using namespace whip;

WhipStorageHostObject::WhipStorageHostObject() {
  store_["__whip_jsi_demo__"] = "jsi-is-synchronous";
}

Value WhipStorageHostObject::get(Runtime& rt, const PropNameID& name) {
  std::string propName = name.utf8(rt);

  if (propName == "getSync") {
    auto self = shared_from_this();
    return Function::createFromHostFunction(
        rt,
        PropNameID::forAscii(rt, "getSync"),
        1,
        [self](Runtime& rt, const Value& /*thisVal*/, const Value* args,
               size_t count) -> Value {
          if (count < 1 || !args[0].isString()) {
            return Value::null();
          }
          std::string key = args[0].getString(rt).utf8(rt);
          auto it = self->store_.find(key);
          if (it == self->store_.end()) {
            return Value::null();
          }
          return String::createFromUtf8(rt, it->second);
        });
  }

  return Value::undefined();
}

std::vector<PropNameID> WhipStorageHostObject::getPropertyNames(Runtime& rt) {
  std::vector<PropNameID> names;
  names.push_back(PropNameID::forAscii(rt, "getSync"));
  return names;
}

void WhipStorageHostObject::install(Runtime& rt) {
  auto hostObj = std::make_shared<WhipStorageHostObject>();
  auto obj = Object::createFromHostObject(rt, hostObj);
  rt.global().setProperty(rt, "__whipStorage", std::move(obj));
}

// ─── JNI entry point ─────────────────────────────────────────────────────────
// Called from Kotlin: WhipJSIInstaller.install(runtimePointer: Long)
// The runtimePointer is a jlong holding the address of the facebook::jsi::Runtime
// instance, obtained via ReactContext.javaScriptContextHolder.get() on the JS thread.
extern "C" JNIEXPORT void JNICALL
Java_com_whipbridge_jsi_WhipJSIInstaller_install(
    JNIEnv* /*env*/, jclass /*cls*/, jlong runtimePointer) {
  if (runtimePointer == 0) {
    return;
  }
  // Reinterpret the raw pointer. This is safe because:
  // 1. The caller (ReactInstanceEventListener.onReactContextInitialized) fires
  //    on the JS thread, so Runtime access is thread-safe.
  // 2. The pointer is non-null (checked above).
  // 3. The Runtime outlives this call — it lives for the duration of the RN session.
  auto* rt = reinterpret_cast<Runtime*>(runtimePointer);
  whip::WhipStorageHostObject::install(*rt);
}
