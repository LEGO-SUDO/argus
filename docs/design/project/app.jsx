// app.jsx — root shell: auth gate + surface switcher + tweaks panel.

const { useState: useStateApp, useEffect: useEffectApp } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "streamSpeed": "normal",
  "providers": ["openai", "anthropic", "gemini", "mock"]
}/*EDITMODE-END*/;

const STREAM_MS = {
  slow:   55,
  normal: 22,
  fast:   8,
};

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [authed, setAuthed] = useStateApp(null); // null = checking; {email} = signed in; false = signed out

  // bootstrap a "session" from localStorage so refresh keeps you in.
  useEffectApp(() => {
    try {
      const s = localStorage.getItem("argus:session");
      if (s) setAuthed(JSON.parse(s));
      else   setAuthed(false);
    } catch { setAuthed(false); }
  }, []);

  const signIn = (u) => {
    try { localStorage.setItem("argus:session", JSON.stringify(u)); } catch {}
    setAuthed(u);
  };
  const signOut = () => {
    try { localStorage.removeItem("argus:session"); } catch {}
    setAuthed(false);
  };

  if (authed === null) return <div style={{ padding: 40, color: "var(--chat-ink-3)" }}></div>;
  if (!authed) return (
    <>
      <AuthView onSignIn={signIn} />
      <TweaksFloating t={t} setTweak={setTweak} />
    </>
  );

  return (
    <StoreProvider>
      <SignedInShell t={t} setTweak={setTweak} onSignOut={signOut} />
    </StoreProvider>
  );
}

function SignedInShell({ t, setTweak, onSignOut }) {
  const store = useStore();
  // wire onSignOut into store for sidebars
  store.onSignOut = onSignOut;

  const streamMs = STREAM_MS[t.streamSpeed] ?? STREAM_MS.normal;
  const providersEnabled = t.providers || ["mock"];

  return (
    <>
      {store.route.surface === "chat" ? (
        <ChatSurface providersEnabled={providersEnabled} streamMs={streamMs} />
      ) : (
        <ConsoleSurface providersEnabled={providersEnabled} streamMs={streamMs} />
      )}
      <TweaksFloating t={t} setTweak={setTweak} />
    </>
  );
}

function TweaksFloating({ t, setTweak }) {
  return (
    <TweaksPanel>
      <TweakSection label="Stream speed" />
      <TweakRadio
        label="speed"
        value={t.streamSpeed}
        options={["slow", "normal", "fast"]}
        onChange={(v) => setTweak("streamSpeed", v)}
      />
      <TweakSection label="Providers configured" />
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {["openai", "anthropic", "gemini", "mock"].map((p) => {
          const on = (t.providers || []).includes(p);
          return (
            <button
              key={p}
              onClick={() => {
                const cur = new Set(t.providers || []);
                if (cur.has(p)) cur.delete(p); else cur.add(p);
                // Always keep mock on.
                if (p === "mock") cur.add("mock");
                setTweak("providers", [...cur]);
              }}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "6px 9px", borderRadius: 6,
                background: on ? "rgba(41,38,27,0.06)" : "transparent",
                fontSize: 11.5,
                color: "#29261b",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: `var(--p-${p})`, display: "inline-block" }}></span>
                {p}
                {p === "mock" && <span style={{ color: "rgba(41,38,27,0.5)", fontSize: 10 }}>(always on)</span>}
              </span>
              <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 10.5, color: on ? "var(--acc)" : "rgba(41,38,27,0.4)" }}>
                {on ? "configured" : "off"}
              </span>
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 10.5, color: "rgba(41,38,27,0.5)", marginTop: 4, lineHeight: 1.4 }}>
        Affects the Replay tab — disabled providers render as “not configured” and offer one-click fallback to mock.
      </div>
    </TweaksPanel>
  );
}

ReactDOM.createRoot(document.getElementById("app")).render(<App />);
