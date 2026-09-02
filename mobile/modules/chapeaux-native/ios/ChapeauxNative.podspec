Pod::Spec.new do |s|
  s.name           = 'ChapeauxNative'
  s.version        = '0.1.0'
  s.summary        = 'Phone-native Chapeaux Fous actions'
  s.description    = 'Explicit user-invoked phone actions for Chapeaux Fous.'
  s.author         = 'Chapeaux Fous'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end

