import { FormEvent, useEffect, useState } from "react";

type AuthMode = "login" | "register" | "verify" | "forgot" | "reset";

async function authRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as { error?: unknown };
  if (!response.ok) throw new Error(payload.error ? String(payload.error) : `HTTP ${response.status}`);
  return payload as T;
}

function modeFromPath(): AuthMode {
  if (location.pathname === "/register") return "register";
  if (location.pathname === "/verify") return "verify";
  if (location.pathname === "/forgot-password") return "forgot";
  if (location.pathname === "/reset-password") return "reset";
  return "login";
}

export default function AuthApp() {
  const [mode, setMode] = useState<AuthMode>(modeFromPath());
  const [name, setName] = useState("");
  const [email, setEmail] = useState(() => sessionStorage.getItem("timev3-auth-email") || "");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const state = new URLSearchParams(location.search).get("state") || "";

  const navigateMode = (next: AuthMode) => {
    const paths: Record<AuthMode, string> = {
      login: "/login", register: "/register", verify: "/verify",
      forgot: "/forgot-password", reset: "/reset-password",
    };
    const query = state ? `?client_id=agent&state=${encodeURIComponent(state)}` : "";
    history.replaceState(null, "", `${paths[next]}${query}`);
    setMode(next); setError(""); setMessage("");
  };

  const continueToAgent = async () => {
    if (state) {
      const result = await authRequest<{ redirectUrl: string }>("/api/auth/authorize", { state });
      location.replace(result.redirectUrl);
      return;
    }
    const config = await authRequest<{ agentUrl: string }>("/api/auth/mode");
    location.replace(new URL("/api/auth/start", config.agentUrl).toString());
  };

  useEffect(() => {
    void authRequest("/api/auth/session").then(() => continueToAgent()).catch(() => {});
    // The state belongs to the initial Agent redirect and stays fixed for this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      if (mode === "register") {
        await authRequest("/api/auth/register", { name, email, password });
        sessionStorage.setItem("timev3-auth-email", email.trim());
        setPassword(""); navigateMode("verify");
        setMessage("Enter the six-digit code sent to your email.");
      } else if (mode === "verify") {
        await authRequest("/api/auth/verify", { email, code });
        sessionStorage.removeItem("timev3-auth-email");
        await continueToAgent();
      } else if (mode === "login") {
        await authRequest("/api/auth/login", { email, password });
        await continueToAgent();
      } else if (mode === "forgot") {
        await authRequest("/api/auth/forgot-password", { email });
        sessionStorage.setItem("timev3-auth-email", email.trim());
        navigateMode("reset");
        setMessage("If that email has an active account, a six-digit reset code was sent.");
      } else {
        await authRequest("/api/auth/reset-password", { email, code, password });
        sessionStorage.removeItem("timev3-auth-email");
        setPassword(""); setCode(""); navigateMode("login");
        setMessage("Password changed. Sign in with your new password.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally { setBusy(false); }
  };

  const resendVerification = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await authRequest<{ message: string }>("/api/auth/resend-verification", { email });
      setMessage(result.message);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };

  const titles: Record<AuthMode, [string, string]> = {
    login: ["Welcome back.", "Sign in to your Time v3 account."],
    register: ["Create your account.", "Your account begins with one private Agent identity."],
    verify: ["Verify your email.", "Enter the six-digit code. It expires in ten minutes."],
    forgot: ["Reset your password.", "Enter your account email to request a reset code."],
    reset: ["Choose a new password.", "Enter the reset code and a new password of at least 12 characters."],
  };
  return <main className="token-gate"><section className="token-card auth-card">
    <img src="/icon.svg" alt="" />
    <p className="eyebrow">Time v3 account</p><h1>{titles[mode][0]}</h1><p>{titles[mode][1]}</p>
    <form onSubmit={submit}>
      {mode === "register" && <label>Name<input autoFocus autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label>}
      <label>Email<input autoFocus={mode !== "register"} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      {(mode === "verify" || mode === "reset") && <label>Six-digit code<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/gu, "").slice(0, 6))} /></label>}
      {(mode === "login" || mode === "register" || mode === "reset") && <label>Password<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} /></label>}
      {error && <p className="auth-message auth-message--error" role="alert">{error}</p>}
      {message && <p className="auth-message" role="status">{message}</p>}
      <button className="button" disabled={busy}>{busy ? "Working…" : mode === "login" ? "Sign in" : mode === "register" ? "Create account" : mode === "verify" ? "Verify email" : mode === "forgot" ? "Send reset code" : "Change password"}</button>
    </form>
    <nav className="auth-links">
      {mode !== "login" && <button type="button" onClick={() => navigateMode("login")}>Sign in</button>}
      {mode !== "register" && <button type="button" onClick={() => navigateMode("register")}>Create account</button>}
      {mode === "login" && <button type="button" onClick={() => navigateMode("forgot")}>Forgot password?</button>}
      {mode === "verify" && <button type="button" disabled={busy || !email} onClick={() => void resendVerification()}>Send a new code</button>}
    </nav>
  </section></main>;
}
