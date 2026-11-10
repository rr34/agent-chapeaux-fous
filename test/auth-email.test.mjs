import assert from "node:assert/strict";
import test from "node:test";
import { AuthEmailService, maskEmailAddress } from "../src/auth-email.mjs";

test("authentication email uses a bounded development-only logged fallback", async () => {
  const messages = [];
  const service = new AuthEmailService({ authEmailFrom: "", smtpUrl: "", smtpHost: "" }, {
    environment: { NODE_ENV: "test" }, logger: { info: (message) => messages.push(message) },
  });
  const result = await service.sendCode({
    purpose: "verify_email", email: "nate@example.com", displayName: "Nate", code: "123456",
  });
  assert.deepEqual(result, { delivery: "logged", maskedEmail: "na**@example.com" });
  assert.equal(messages.length, 1);
  assert.match(messages[0], /purpose=verify_email/);
});

test("production refuses to disclose a code when SMTP is not configured", async () => {
  const service = new AuthEmailService({ authEmailFrom: "", smtpUrl: "", smtpHost: "" }, {
    environment: { NODE_ENV: "production" }, logger: { info() {} },
  });
  await assert.rejects(() => service.sendCode({
    purpose: "reset_password", email: "nate@example.com", displayName: "Nate", code: "123456",
  }), /not configured/);
  assert.equal(maskEmailAddress("a@example.com"), "a*@example.com");
});
