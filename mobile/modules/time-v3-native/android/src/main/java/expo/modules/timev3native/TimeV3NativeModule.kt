package expo.modules.timev3native

import android.content.Intent
import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class TimeV3NativeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TimeV3Native")

    AsyncFunction("composeText") { recipient: String, body: String ->
      val context = appContext.reactContext
        ?: throw IllegalStateException("Android activity is unavailable")
      val destination = if (recipient.isBlank()) "smsto:" else "smsto:${Uri.encode(recipient)}"
      val intent = Intent(Intent.ACTION_SENDTO, Uri.parse(destination)).apply {
        putExtra("sms_body", body)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      if (intent.resolveActivity(context.packageManager) == null) {
        throw IllegalStateException("No messaging app can handle this draft")
      }
      context.startActivity(intent)
    }
  }
}

