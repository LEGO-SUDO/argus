// store.jsx — shared mock store for conversations + inference traces
// Both /chat and /console read from this. Posts a tiny event bus so views
// can react to new inferences (the "near-real-time" feel from the PRD).

const { useState, useEffect, useRef, useMemo, useCallback, createContext, useContext } = React;

/* ── pricing (per-1k-token USD; snapshot 2026-05-23, best-effort) ─────── */
const PRICING = {
  "gpt-4o":           { prompt: 0.0025, completion: 0.01,  provider: "openai" },
  "gpt-4o-mini":      { prompt: 0.00015,completion: 0.0006,provider: "openai" },
  "claude-sonnet-4.5":{ prompt: 0.003,  completion: 0.015, provider: "anthropic" },
  "claude-haiku-4.5": { prompt: 0.0008, completion: 0.004, provider: "anthropic" },
  "gemini-2.5-pro":   { prompt: 0.00125,completion: 0.005, provider: "gemini" },
  "gemini-2.5-flash": { prompt: 0.00010,completion: 0.0004,provider: "gemini" },
  "mock-stream-v1":   { prompt: 0,      completion: 0,     provider: "mock" },
};

const PROVIDER_LABEL = {
  openai:    "OpenAI",
  anthropic: "Anthropic",
  gemini:    "Gemini",
  mock:      "Mock",
};

const DEFAULT_MODEL_FOR = {
  openai:    "gpt-4o-mini",
  anthropic: "claude-sonnet-4.5",
  gemini:    "gemini-2.5-flash",
  mock:      "mock-stream-v1",
};

/* ── id helpers ──────────────────────────────────────────────────────── */
const newId = (p = "id") =>
  `${p}_${Math.random().toString(36).slice(2, 7)}${Date.now().toString(36).slice(-4)}`;

/* ── seed data ───────────────────────────────────────────────────────── */
function buildSeed() {
  const now = Date.now();

  // 4 seed conversations
  const convs = [
    {
      id: "conv_intro",
      title: "Welcome to Argus",
      created: now - 1000 * 60 * 90,
      messages: [
        { id: newId("m"), role: "user",      text: "What is Argus?", t: now - 1000*60*90 },
        {
          id: newId("m"), role: "assistant",
          text: "Argus is a streaming chatbot in front of an inference-logging pipeline. Every model call you make here lands in /console — Traces, Cost, and Replay all read the same data.",
          t: now - 1000*60*89,
          provider: "anthropic",
          model: "claude-sonnet-4.5",
          traceId: null, // wired below
        },
      ],
    },
    {
      id: "conv_pricing",
      title: "Sketch: pricing for an indie SaaS",
      created: now - 1000 * 60 * 60 * 4,
      messages: [
        { id: newId("m"), role: "user", text: "Suggest 3 pricing tiers for an indie analytics SaaS.", t: now - 1000*60*60*4 },
        {
          id: newId("m"), role: "assistant",
          text: "Three tiers, each one a clean step up:\n\n1. Starter — $19/mo. Single project, 30-day retention. Email support.\n2. Studio — $79/mo. 5 projects, 1-year retention, shareable dashboards, Slack alerts.\n3. Team — $249/mo. Unlimited projects, SSO, audit log, named CSM, priority replay.\n\nAnchor on Studio in your pricing page — make it the visually featured plan.",
          t: now - 1000*60*60*4 + 8000,
          provider: "openai",
          model: "gpt-4o",
        },
        { id: newId("m"), role: "user", text: "Make Team feel more 'enterprise'.", t: now - 1000*60*60*3 },
        {
          id: newId("m"), role: "assistant",
          text: "Rename it Enterprise. Drop the public price (\"Contact us\"), add SAML, data residency, custom DPAs, and a 99.9% uptime SLA. The plan should read like a procurement doc, not a checkout.",
          t: now - 1000*60*60*3 + 9000,
          provider: "anthropic",
          model: "claude-sonnet-4.5",
        },
      ],
    },
    {
      id: "conv_haiku",
      title: "A haiku about logs",
      created: now - 1000 * 60 * 60 * 26,
      messages: [
        { id: newId("m"), role: "user", text: "Write a tiny poem about reading log lines.", t: now - 1000*60*60*26 },
        {
          id: newId("m"), role: "assistant",
          text: "rows scroll like rainfall\neach line a small confession\nuptime answers back",
          t: now - 1000*60*60*26 + 3500,
          provider: "gemini",
          model: "gemini-2.5-pro",
        },
      ],
    },
    {
      id: "conv_failover",
      title: "Demo: provider failover",
      created: now - 1000 * 60 * 60 * 50,
      messages: [
        { id: newId("m"), role: "user", text: "Summarize the failover policy.", t: now - 1000*60*60*50 },
        {
          id: newId("m"), role: "assistant",
          text: "Pre-first-token failure → silently retry against next configured provider. Mid-stream failure → mark turn failed, surface a retry button to the user. Streams never stitch across providers. Per-turn provider identity is shown in the UI.",
          t: now - 1000*60*60*50 + 4200,
          provider: "anthropic",
          model: "claude-sonnet-4.5",
          failoverFrom: "openai",
        },
      ],
    },
  ];

  // Build traces from those assistant messages + some extra historical noise.
  const traces = [];
  const pushTrace = (overrides) => {
    const t = {
      id: newId("trc"),
      ts: Date.now(),
      provider: "mock",
      model: "mock-stream-v1",
      status: "ok",
      latencyMs: 800,
      ttftMs: 240,
      promptTok: 100,
      completionTok: 200,
      conversationId: null,
      turnId: null,
      preview: { input: "", output: "" },
      failoverFrom: null,
      ...overrides,
    };
    traces.push(t);
    return t;
  };

  for (const c of convs) {
    for (let i = 0; i < c.messages.length; i++) {
      const m = c.messages[i];
      if (m.role !== "assistant") continue;
      const prevUser = c.messages[i - 1];
      const tr = pushTrace({
        ts: m.t,
        provider: m.provider,
        model: m.model,
        status: "ok",
        latencyMs: 600 + Math.round(Math.random() * 1800),
        ttftMs:    200 + Math.round(Math.random() * 380),
        promptTok: 30 + Math.round(Math.random() * 400),
        completionTok: estimateTokens(m.text),
        conversationId: c.id,
        turnId: m.id,
        preview: { input: prevUser?.text || "", output: m.text },
        failoverFrom: m.failoverFrom || null,
      });
      m.traceId = tr.id;
    }
  }

  // A few extra traces for density: failed, canceled, timed-out.
  pushTrace({
    ts: Date.now() - 1000 * 60 * 18,
    provider: "openai", model: "gpt-4o",
    status: "failed", latencyMs: 412,
    promptTok: 84, completionTok: 0,
    conversationId: "conv_pricing", turnId: newId("m"),
    preview: { input: "Reword the Enterprise blurb tighter.", output: "" },
    errorCode: "upstream_503",
  });
  pushTrace({
    ts: Date.now() - 1000 * 60 * 9,
    provider: "anthropic", model: "claude-haiku-4.5",
    status: "canceled", latencyMs: 1240,
    promptTok: 132, completionTok: 47,
    conversationId: "conv_pricing", turnId: newId("m"),
    preview: { input: "Draft a launch tweet.", output: "Excited to share what we've been—" },
  });
  pushTrace({
    ts: Date.now() - 1000 * 60 * 33,
    provider: "gemini", model: "gemini-2.5-flash",
    status: "timeout", latencyMs: 30000,
    promptTok: 220, completionTok: 0,
    conversationId: "conv_haiku", turnId: newId("m"),
    preview: { input: "Generate 12 product names.", output: "" },
    errorCode: "deadline_exceeded",
  });

  // Synthetic historical traffic across the last 24h so the Cost chart has shape.
  // Plausible token counts, weighted toward cheaper models.
  const histInputs = [
    ["Summarize this Slack thread in 4 bullets.", "openai", "gpt-4o-mini", 320, 180],
    ["Refactor this Postgres query for readability.", "anthropic", "claude-sonnet-4.5", 540, 410],
    ["Suggest names for an analytics CLI.", "openai", "gpt-4o", 110, 220],
    ["What's a good greeting for an onboarding email?", "anthropic", "claude-haiku-4.5", 90, 140],
    ["Explain server-sent events vs websockets.", "gemini", "gemini-2.5-pro", 95, 380],
    ["Rewrite this paragraph for marketing.", "anthropic", "claude-sonnet-4.5", 230, 290],
    ["List edge cases for a token-bucket rate limiter.", "openai", "gpt-4o-mini", 70, 410],
    ["Translate the welcome screen to Spanish.", "gemini", "gemini-2.5-flash", 140, 220],
    ["Audit this regex.", "anthropic", "claude-haiku-4.5", 60, 120],
    ["Draft a release note for v0.4.2.", "openai", "gpt-4o", 90, 260],
    ["Generate three taglines under 8 words.", "anthropic", "claude-sonnet-4.5", 50, 90],
    ["Convert this JSON schema to TypeScript types.", "openai", "gpt-4o-mini", 380, 510],
    ["Polish this changelog entry.", "anthropic", "claude-sonnet-4.5", 110, 150],
    ["Summarize a 3-page RFC into 6 bullets.", "gemini", "gemini-2.5-pro", 1800, 320],
    ["What are good defaults for retry backoff?", "openai", "gpt-4o", 80, 260],
    ["Quick code review of this hook.", "anthropic", "claude-sonnet-4.5", 420, 340],
    ["Mock a 'no providers available' error UI.", "openai", "gpt-4o-mini", 140, 200],
    ["Idea: weekly digest email — feedback?", "anthropic", "claude-haiku-4.5", 230, 170],
    ["Pick a colorblind-safe palette of 5.", "gemini", "gemini-2.5-flash", 70, 130],
    ["Rephrase: 'we apologize for the inconvenience'.", "openai", "gpt-4o-mini", 50, 80],
  ];
  for (let i = 0; i < histInputs.length; i++) {
    const [inp, prov, model, pt, ct] = histInputs[i];
    // spread across last 24h with most weight in last 8 hours
    const hoursBack = (i * 23) / histInputs.length + (Math.sin(i) * 0.6);
    const ts = Date.now() - hoursBack * 3600 * 1000;
    pushTrace({
      ts,
      provider: prov, model,
      status: "ok",
      latencyMs: 600 + Math.round(700 + Math.sin(i * 1.7) * 400),
      ttftMs:    220 + Math.round(180 + Math.cos(i * 1.3) * 90),
      promptTok: pt, completionTok: ct,
      conversationId: "conv_intro", turnId: newId("m"),
      preview: { input: inp, output: "" },
    });
  }

  // sort traces oldest→newest then we'll reverse for display
  traces.sort((a, b) => a.ts - b.ts);

  return { convs, traces };
}

function estimateTokens(s) {
  if (!s) return 0;
  return Math.max(1, Math.round(s.length / 3.6));
}

/* ── Store ───────────────────────────────────────────────────────────── */
const StoreCtx = createContext(null);

function StoreProvider({ children }) {
  const seedRef = useRef(null);
  if (!seedRef.current) seedRef.current = buildSeed();

  const [convs,  setConvs]  = useState(seedRef.current.convs);
  const [traces, setTraces] = useState(seedRef.current.traces);
  const [activeConvId, setActiveConvId] = useState(null); // null = empty/hero
  const [user] = useState({ email: "demo@argus.dev", name: "Demo" });
  const [route, setRoute] = useState({ surface: "chat", tab: "traces", traceId: null, replayId: null });

  // append helpers
  const upsertConv = useCallback((conv) => {
    setConvs((cs) => {
      const i = cs.findIndex((c) => c.id === conv.id);
      if (i === -1) return [conv, ...cs];
      const next = cs.slice();
      next[i] = conv;
      return next;
    });
  }, []);

  const appendMessage = useCallback((convId, message) => {
    setConvs((cs) =>
      cs.map((c) =>
        c.id === convId ? { ...c, messages: [...c.messages, message] } : c
      )
    );
  }, []);

  const patchMessage = useCallback((convId, msgId, patch) => {
    setConvs((cs) =>
      cs.map((c) => {
        if (c.id !== convId) return c;
        return {
          ...c,
          messages: c.messages.map((m) => (m.id === msgId ? { ...m, ...patch } : m)),
        };
      })
    );
  }, []);

  const addTrace = useCallback((tr) => {
    setTraces((ts) => [...ts, tr]);
  }, []);

  const patchTrace = useCallback((id, patch) => {
    setTraces((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const value = useMemo(
    () => ({
      user,
      convs, setConvs, upsertConv, appendMessage, patchMessage,
      traces, addTrace, patchTrace,
      activeConvId, setActiveConvId,
      route, setRoute,
    }),
    [user, convs, traces, activeConvId, route, upsertConv, appendMessage, patchMessage, addTrace, patchTrace]
  );

  return React.createElement(StoreCtx.Provider, { value }, children);
}

function useStore() {
  const v = useContext(StoreCtx);
  if (!v) throw new Error("useStore: missing provider");
  return v;
}

/* ── cost helpers ────────────────────────────────────────────────────── */
function priceFor(trace) {
  const p = PRICING[trace.model];
  if (!p) return null; // unknown → "—"
  return {
    prompt:     (trace.promptTok     / 1000) * p.prompt,
    completion: (trace.completionTok / 1000) * p.completion,
    total:      (trace.promptTok / 1000) * p.prompt + (trace.completionTok / 1000) * p.completion,
  };
}

function fmtUSD(n) {
  if (n == null) return "—";
  if (n === 0) return "$0.00";
  if (n < 0.005) return "<$0.01";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtTok(n) { return (n ?? 0).toLocaleString("en-US"); }
function fmtMs(n)  { return `${(n ?? 0).toLocaleString("en-US")}ms`; }
function relTime(ts) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60)    return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60)    return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24)    return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

// Expose for other Babel scripts (separate scopes).
Object.assign(window, {
  StoreProvider, useStore, newId, estimateTokens,
  PRICING, PROVIDER_LABEL, DEFAULT_MODEL_FOR,
  priceFor, fmtUSD, fmtTok, fmtMs, relTime,
});
