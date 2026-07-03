#include "WhipStorageHostObject.h"
#include <memory>

using namespace facebook::jsi;
using namespace whip;

WhipStorageHostObject::WhipStorageHostObject() {
  // Pre-populate a sentinel value so the Loom demo can verify end-to-end:
  //   (global).__whipStorage.getSync('__whip_jsi_demo__') === 'jsi-is-synchronous'
  store_["__whip_jsi_demo__"] = "jsi-is-synchronous";
}

Value WhipStorageHostObject::get(Runtime& rt, const PropNameID& name) {
  std::string propName = name.utf8(rt);

  if (propName == "getSync") {
    // Capture via shared_ptr so the closure outlives any individual get() call.
    // The HostObject is owned by the JSI runtime via createFromHostObject, which
    // holds a shared_ptr<HostObject>. shared_from_this() adds a second owner for
    // the lambda, preventing use-after-free if JS holds the function beyond the
    // HostObject's lifetime.
    auto self = shared_from_this();
    return Function::createFromHostFunction(
        rt,
        PropNameID::forAscii(rt, "getSync"),
        1,  // 1 formal parameter: key
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
  return {PropNameID::forAscii(rt, "getSync")};
}

void WhipStorageHostObject::install(Runtime& rt) {
  auto hostObj = std::make_shared<WhipStorageHostObject>();
  // createFromHostObject wraps the shared_ptr in a jsi::Object. From this
  // point the runtime owns a reference; the object lives until the runtime
  // is torn down or the property is overwritten.
  auto obj = Object::createFromHostObject(rt, hostObj);
  rt.global().setProperty(rt, "__whipStorage", std::move(obj));
}
