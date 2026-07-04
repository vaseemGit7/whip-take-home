Pod::Spec.new do |s|
  s.name         = 'WhipJSI'
  s.version      = '1.0.0'
  s.summary      = 'JSI storage HostObject for WhipBridge'
  s.homepage     = 'https://github.com/placeholder'
  s.license      = { :type => 'MIT' }
  s.author       = 'WhipBridge'
  s.platform     = :ios, '13.4'
  s.source       = { :path => '.' }

  s.source_files = '*.{h,mm}'

  s.requires_arc = true

  s.pod_target_xcconfig = {
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    'CLANG_CXX_LIBRARY'           => 'libc++'
  }

  s.dependency 'React-Core'
  s.dependency 'React-jsi'
end
