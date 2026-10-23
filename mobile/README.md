# Time V3 Technology Agent mobile

Android-first Expo development client for the Time V3 Technology Agent HTTP service. The mobile app is a client only: typed and recorded requests enter the server's existing FIFO queue and preserve its orientation, execution, audit, repair, and usage trace.

## Included in the first development build

- HTTPS server pairing with the bearer token stored by `expo-secure-store`
- recent request history with live queue/progress polling
- exact typed-request submission to `POST /api/requests`
- native audio recording and raw upload to `POST /api/voice`
- explicit Android `ACTION_SENDTO` handoff to the default messaging app

The messaging handoff creates a draft. Time V3 Technology Agent does not send it and is not the default SMS application.

## Development

```bash
cd mobile
npm install
npx expo prebuild --platform android
npx expo run:android
```

This project requires a development build, not Expo Go, because `modules/time-v3-native` contains native Kotlin/Swift code.

For the Android emulator, the app permits `http://10.0.2.2` for local development. All other configured server addresses must use HTTPS.

## First physical Android phone

The debug APK is generated at:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

On a fresh phone:

1. Connect the phone to Wi-Fi and finish Android's initial setup and system updates.
2. In Windows File Explorer, open `\\wsl.localhost\Ubuntu-22.04\home\nate\code\agent-chapeaux-fous\mobile\android\app\build\outputs\apk\debug`, then transfer `app-debug.apk` to the phone's **Download** folder by USB, cloud storage, or another trusted file-transfer method.
3. Open the APK on the phone. When Android asks, allow the app used to open the file to install unknown apps, then install it.
4. Launch **Time V3 Technology Agent**. Android may show the Expo development-client launcher until Metro is available.
5. On the development computer, run:

   ```bash
   cd /home/nate/code/agent-chapeaux-fous/mobile
   npm start -- --tunnel
   ```

6. Open the tunnel URL or scan its QR code from the development-client launcher. Keep that terminal running while developing.
7. In the app, enter the production HTTPS server address and bearer token, then use **TEST & CONNECT**.

This direct APK route does not require Google Play, Android Studio, Developer Options, or USB debugging. After installation, turn off the temporary **Install unknown apps** permission if you do not otherwise use it.

JavaScript, TypeScript, styling, and ordinary API-client edits use Fast Refresh and do not require reinstalling the APK. Rebuild and reinstall after changing Kotlin, Swift, native dependencies, native permissions, services, intent declarations, or `app.json` native configuration.

To rebuild the debug APK:

```bash
cd /home/nate/code/agent-chapeaux-fous/mobile
npx expo prebuild --clean --platform android
cd android
./gradlew assembleDebug
```
