Pod::Spec.new do |s|
  s.name           = 'TimeV3Native'
  s.version        = '0.1.0'
  s.summary        = 'Phone-native Time V3 Technology Agent actions'
  s.description    = 'Explicit user-invoked phone actions for Time V3 Technology Agent.'
  s.author         = 'Time V3 Technology'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
