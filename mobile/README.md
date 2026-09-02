# Chapeaux Fous mobile

Android-first Expo development client for the Agent Slayer HTTP service. The mobile app is a client only: typed and recorded requests enter the server's existing FIFO queue and preserve its orientation, execution, audit, repair, and usage trace.

## Included in the first development build

- HTTPS server pairing with the bearer token stored by `expo-secure-store`
- recent request history with live queue/progress polling
- exact typed-request submission to `POST /api/requests`
- native audio recording and raw upload to `POST /api/voice`
- explicit Android `ACTION_SENDTO` handoff to the default messaging app

The messaging handoff creates a draft. Chapeaux Fous does not send it and is not the default SMS application.

## Development

```bash
cd mobile
npm install
npx expo prebuild --platform android
npx expo run:android
```

This project requires a development build, not Expo Go, because `modules/chapeaux-native` contains native Kotlin/Swift code.

For the Android emulator, the app permits `http://10.0.2.2` for local development. All other configured server addresses must use HTTPS.

