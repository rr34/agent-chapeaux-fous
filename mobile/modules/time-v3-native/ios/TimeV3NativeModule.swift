import ExpoModulesCore
import MessageUI
import UIKit

public class TimeV3NativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TimeV3Native")

    AsyncFunction("composeText") { (recipient: String, body: String) in
      let separator = body.isEmpty ? "" : "&body=\(body.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")"
      let encodedRecipient = recipient.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? ""
      guard let url = URL(string: "sms:\(encodedRecipient)?\(separator)") else {
        throw InvalidMessageUrlException()
      }
      await UIApplication.shared.open(url)
    }
  }
}

private class InvalidMessageUrlException: Exception {
  override var reason: String { "Could not create a Messages draft URL" }
}
