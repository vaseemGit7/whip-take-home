Pod::Spec.new do |s|
  s.name         = 'WhipJSI'
  s.version      = '1.0.0'
  s.summary      = 'JSI storage HostObject for WhipBridge'
  s.homepage     = 'https://github.com/placeholder'
  s.license      = { :type => 'MIT' }
  s.author       = 'WhipBridge'
  s.platform     = :ios, '13.4'
  s.source       = { :path => '.' }

  # Compile all ObjC++ files in this directory.
  s.source_files = '*.{h,mm}'

  s.requires_arc = true

  # C++17 for std::optional and structured bindings used in the HostObject.
  s.pod_target_xcconfig = {
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    'CLANG_CXX_LIBRARY'           => 'libc++'
  }

  # React-Core provides RCTBridgeModule, RCTBridge+Private, RCTUtils (RCTJSThread).
  # React-jsi provides jsi/jsi.h and the JSI runtime headers.
  s.dependency 'React-Core'
  s.dependency 'React-jsi'
end
