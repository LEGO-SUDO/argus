// auth.jsx — Sign in / Sign up screens.

const { useState: useStateA } = React;

function AuthView({ onSignIn }) {
  const [mode, setMode]   = useStateA("signin"); // signin | signup
  const [email, setEmail] = useStateA("");
  const [pwd, setPwd]     = useStateA("");
  const [pwd2, setPwd2]   = useStateA("");
  const [err, setErr]     = useStateA(null);

  const submit = (e) => {
    e.preventDefault();
    setErr(null);
    if (!email.match(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)) { setErr("Enter a valid email address."); return; }
    if (pwd.length < 8) { setErr("Password must be at least 8 characters."); return; }
    if (mode === "signup" && pwd !== pwd2) { setErr("Passwords don't match."); return; }
    // Mock “duplicate email” for any existing demo@ if signing up.
    if (mode === "signup" && email === "demo@argus.dev") {
      setErr("An account with that email already exists. Try signing in instead.");
      return;
    }
    // Mock invalid credentials path for sign-in: only the demo user passes by default.
    if (mode === "signin" && !(email === "demo@argus.dev" && pwd === "let-me-in-9")) {
      setErr("Email or password is incorrect.");
      return;
    }
    onSignIn({ email });
  };

  const fillDemo = () => {
    setEmail("demo@argus.dev");
    setPwd("let-me-in-9");
    setErr(null);
  };

  return (
    <div className="auth-shell">
      <aside className="auth-side">
        <div>
          <BrandMark />
          <div className="seal" style={{ marginTop: 24 }}>inference observability · 2026</div>
        </div>
        <div className="pitch">
          <h1>Chat first.<br/>Observe <em>everything</em>.</h1>
          <p>
            A streaming multi-provider chatbot stitched to an inference-logging pipeline.
            Every model call from <span className="mono" style={{ fontSize: 13 }}>/chat</span> shows up in the
            operator console within ~5 seconds — same data, three lenses.
          </p>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", color: "var(--chat-ink-3)", fontSize: 11.5 }}>
          <span className="mono">v0.4.2 · mock-stream-v1</span>
          <span>OTel-native · self-hosted</span>
        </div>
      </aside>

      <main className="auth-form-wrap">
        <form className="auth-form" onSubmit={submit}>
          <h2>{mode === "signin" ? "Welcome back" : "Create your account"}</h2>
          <div className="sub">
            {mode === "signin"
              ? "Sign in to resume your conversations."
              : "Sign up with email + password. Takes one second."}
          </div>

          {err && <div className="err-banner">{err}</div>}

          <div className="field">
            <label>Email</label>
            <input
              type="email" autoComplete="email" autoFocus
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={pwd} onChange={(e) => setPwd(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          {mode === "signup" && (
            <div className="field">
              <label>Confirm password</label>
              <input
                type="password" autoComplete="new-password"
                value={pwd2} onChange={(e) => setPwd2(e.target.value)}
                placeholder="••••••••"
              />
            </div>
          )}

          <button className="btn-primary" type="submit">
            {mode === "signin" ? "Sign in" : "Create account"}
          </button>

          <div className="switch">
            {mode === "signin" ? (
              <>New here? <button type="button" onClick={() => { setErr(null); setMode("signup"); }}>Create an account</button></>
            ) : (
              <>Already have one? <button type="button" onClick={() => { setErr(null); setMode("signin"); }}>Sign in</button></>
            )}
          </div>

          <div className="demo-hint">
            <b>Trying the demo?</b><br/>
            A demo account is seeded on first boot: <code>demo@argus.dev</code> / <code>let-me-in-9</code>.
            <br/>
            <button type="button" className="fill-demo" onClick={fillDemo}>Fill demo credentials →</button>
          </div>
        </form>
      </main>
    </div>
  );
}

Object.assign(window, { AuthView });
