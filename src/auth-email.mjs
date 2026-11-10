import nodemailer from "nodemailer";

export function maskEmailAddress(value) {
  const email = String(value ?? "").trim().toLowerCase();
  const separator = email.lastIndexOf("@");
  if (separator < 1) return email;
  const local = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  return `${local.slice(0, Math.min(2, local.length))}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
}

export class AuthEmailService {
  constructor(config, { environment = process.env, logger = console } = {}) {
    this.config = config;
    this.environment = environment;
    this.logger = logger;
    this.transport = null;
  }

  configured() {
    return Boolean((this.config.smtpUrl || this.config.smtpHost) && this.config.authEmailFrom);
  }

  getTransport() {
    if (this.transport) return this.transport;
    if (this.config.smtpUrl) this.transport = nodemailer.createTransport(this.config.smtpUrl);
    else if (this.config.smtpHost) {
      this.transport = nodemailer.createTransport({
        host: this.config.smtpHost,
        port: this.config.smtpPort,
        secure: this.config.smtpSecure,
        auth: this.config.smtpUser
          ? { user: this.config.smtpUser, pass: this.config.smtpPassword }
          : undefined,
      });
    }
    return this.transport;
  }

  async sendCode({ purpose, email, displayName, code }) {
    const recipient = String(email ?? "").trim().toLowerCase();
    const normalizedCode = String(code ?? "").trim();
    if (!recipient || !/^\d{6}$/u.test(normalizedCode)) throw new Error("A recipient and six-digit code are required");
    const isReset = purpose === "reset_password";
    const subject = isReset ? "Reset your Time v3 password" : "Verify your Time v3 account";
    const text = [
      `Hi ${String(displayName ?? "").trim() || "there"},`,
      "",
      isReset
        ? `Your Time v3 password-reset code is: ${normalizedCode}`
        : `Your Time v3 verification code is: ${normalizedCode}`,
      "",
      "It expires in 10 minutes.",
      `If you did not ${isReset ? "request a password reset" : "create this account"}, you can ignore this email.`,
    ].join("\n");
    const transport = this.getTransport();
    if (!transport || !this.config.authEmailFrom) {
      if (this.environment.NODE_ENV !== "production") {
        this.logger.info(`[timev3-auth-code] purpose=${purpose} email=${recipient} code=${normalizedCode}`);
        return { delivery: "logged", maskedEmail: maskEmailAddress(recipient) };
      }
      throw Object.assign(new Error("Time v3 authentication email is not configured."), {
        code: "AUTH_EMAIL_NOT_CONFIGURED", statusCode: 503,
      });
    }
    await transport.sendMail({ from: this.config.authEmailFrom, to: recipient, subject, text });
    return { delivery: "email", maskedEmail: maskEmailAddress(recipient) };
  }
}
