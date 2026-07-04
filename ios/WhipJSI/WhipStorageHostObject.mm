#include "WhipStorageHostObject.h"
#include <memory>

using namespace facebook::jsi;
using namespace whip;

WhipStorageHostObject::WhipStorageHostObject() {}

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
          // Demo sentinel — proves a synchronous round-trip with no async hop.
          if (key == "__whip_jsi_demo__") {
            return String::createFromUtf8(rt, "jsi-is-synchronous");
          }
          return Value::null();
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
  // createFromHostObject wraps the shared_ptr in a jsi::Object. From this
  // point the runtime owns a reference; the object lives until the runtime
  // is torn down or the property is overwritten.
  auto obj = Object::createFromHostObject(rt, hostObj);
  rt.global().setProperty(rt, "__whipStorage", std::move(obj));
}
