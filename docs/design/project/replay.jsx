// replay.jsx — Replay tab (the load-bearing demo per the PRD)
// Pick a past inference, re-run against any provider, see side-by-side
// + cost/latency deltas + an inline word-level diff.

const { useState: useStateR, useMemo: useMemoR, useEffect: useEffectR } = React;

function ReplayTab({ providersEnabled, streamMs }) {
  const store = useStore();
  const { traces, route, setRoute } = store;

  // Eligible: status != streaming, != canceled
  const eligible = useMemoR(
    () => traces.filter((t) => t.status !== "canceled" && t.status !== "streaming"),
    [traces]
  );

  // current source — from route or default to the latest eligible
  const sourceId = route.replayId || eligible.at(-1)?.id;
  const source = traces.find((t) => t.id === sourceId);

  const [target, setTarget] = useStateR(null);
  // initialize target = a different provider than source
  useEffectR(() => {
    if (!source) return;
    if (target) return;
    const order = ["anthropic", "openai", "gemini", "mock"];
    const pick = order.find((p) => p !== source.provider) || "mock";
    setTarget(pick);
  }, [source?.id]);

  const [replay, setReplay] = useStateR(null); // { provider, model, status, latencyMs, ttftMs, promptTok, completionTok, output, startedAt }
  const [running, setRunning] = useStateR(false);

  // Reset replay when source changes.
  useEffectR(() => { setReplay(null); }, [source?.id, target]);

  const isAvailable = (p) => providersEnabled.includes(p) || p === "mock";

  const run = async () => {
    if (!source || !target) return;
    const usingMockFallback = !isAvailable(target);
    const effective = usingMockFallback ? "mock" : target;
    const model = DEFAULT_MODEL_FOR[effective];

    setRunning(true);
    const initial = {
      provider: effective, model,
      status: "streaming",
      latencyMs: 0, ttftMs: 0,
      promptTok: source.promptTok, completionTok: 0,
      output: "",
      startedAt: Date.now(),
      usedFallback: usingMockFallback,
    };
    setReplay(initial);

    const t0 = performance.now();
    let firstAt = null;
    let full = "";
    try {
      const messages = [{
        role: "user",
        content:
          "[argus replay context — be concise, friendly, concrete; 1–3 short paragraphs unless asked.]\n\n" +
          (source.preview?.input || ""),
      }];
      const text = await Promise.race([
        window.claude.complete({ messages }),
        new Promise((res) => setTimeout(() => res(null), 15000)),
      ]);
      full = (text && typeof text === "string" && text.trim()) ? text.trim() : cannedReplayReply(source.preview?.input || "");
    } catch (e) {
      full = cannedReplayReply(source.preview?.input || "");
    }

    const parts = chunkReplay(full, 3);
    for (let i = 0; i < parts.length; i++) {
      if (firstAt == null) firstAt = performance.now();
      const partial = parts.slice(0, i + 1).join("");
      setReplay((r) => r && ({ ...r, output: partial, completionTok: estimateTokens(partial) }));
      await new Promise((res) => setTimeout(res, streamMs));
    }
    const t1 = performance.now();

    // commit final stats
    setReplay((r) => r && ({
      ...r,
      status: "ok",
      output: full,
      completionTok: estimateTokens(full),
      latencyMs: Math.round(t1 - t0),
      ttftMs:    firstAt ? Math.round(firstAt - t0) : 0,
    }));

    // Also record this replay as a new trace in the store, so it appears in Traces/Cost.
    store.addTrace({
      id: newId("trc"),
      ts: Date.now(),
      provider: effective,
      model,
      status: "ok",
      latencyMs: Math.round(t1 - t0),
      ttftMs: firstAt ? Math.round(firstAt - t0) : 0,
      promptTok: source.promptTok,
      completionTok: estimateTokens(full),
      conversationId: source.conversationId,
      turnId: newId("m"),
      preview: { input: source.preview?.input || "", output: full.slice(0, 200) },
      replayOf: source.id,
    });

    setRunning(false);
  };

  if (eligible.length === 0) {
    return (
      <div className="empty">
        <div className="card">
          <div className="glyph"><Icon name="replay" size={16} /></div>
          <h3>Nothing to replay yet</h3>
          <p>Send a message in /chat — successful, failed, and timed-out turns all become replay candidates.</p>
          <button className="cta" onClick={() => store.setRoute({ ...store.route, surface: "chat" })}>
            Open /chat <Icon name="arrow-right" size={11} />
          </button>
        </div>
      </div>
    );
  }

  if (!source) {
    return <div className="empty"><div className="card"><h3>Pick an inference</h3></div></div>;
  }

  const srcPrice = priceFor(source);
  const repPrice = replay ? priceFor({ model: replay.model, provider: replay.provider, promptTok: replay.promptTok, completionTok: replay.completionTok }) : null;

  const latDelta  = replay ? replay.latencyMs - source.latencyMs : 0;
  const costDelta = (replay && repPrice && srcPrice) ? repPrice.total - srcPrice.total : 0;

  return (
    <div className="replay-shell">
      <div className="replay-picker">
        <span className="lab">source</span>
        <SourceMenu source={source} eligible={eligible} onPick={(t) => setRoute({ ...store.route, replayId: t.id })} />
        <span className="arrow"><Icon name="arrow-right" size={12} /></span>
        <span className="lab">replay against</span>
        <div className="target-pick">
          {["openai", "anthropic", "gemini", "mock"].map((p) => {
            const unavailable = !isAvailable(p);
            return (
              <button
                key={p}
                className={(target === p ? "active " : "") + (unavailable ? "unavailable" : "")}
                onClick={() => setTarget(p)}
                title={unavailable ? "not configured — will fall back to mock" : ""}
              >
                <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: `var(--p-${p})` }}></span>
                {p}
                {p === source.provider && <span style={{ color: "var(--con-dim-2)", marginLeft: 4, fontSize: 9.5 }}>(orig)</span>}
              </button>
            );
          })}
        </div>
        <button className="run-btn" onClick={run} disabled={running || !target}>
          {running ? <><Spinner /> Replaying…</> : <><Icon name="replay" size={11} /> Run replay</>}
        </button>
      </div>

      <div className="replay-cmp">
        {/* ORIGINAL */}
        <div className="replay-col">
          <div className="colhd">
            <div className="lab">original</div>
            <div className="now"><span className="ptag" data-prov={source.provider}><span className="swatch"></span>{source.provider}</span> · <span className="mono" style={{ color: "var(--con-dim)" }}>{source.model}</span></div>
          </div>
          <div className="metrics">
            <div className="metric"><div className="ml">latency</div><div className="mv">{fmtMs(source.latencyMs)}</div></div>
            <div className="metric"><div className="ml">tokens p / c</div><div className="mv" style={{ fontSize: 14 }}>{fmtTok(source.promptTok)} / {fmtTok(source.completionTok)}</div></div>
            <div className="metric"><div className="ml">cost</div><div className="mv">{srcPrice ? fmtUSD(srcPrice.total) : "—"}</div></div>
          </div>
          <div className="output">
            <div style={{ color: "var(--con-dim-2)", fontSize: 10.5, marginBottom: 8, letterSpacing: "0.06em", textTransform: "uppercase" }}>input</div>
            <div style={{ color: "var(--con-dim)", marginBottom: 14, padding: "8px 10px", background: "oklch(0.21 0.008 270)", borderRadius: 4, border: "1px solid var(--con-rule)" }}>{source.preview?.input || "—"}</div>
            <div style={{ color: "var(--con-dim-2)", fontSize: 10.5, marginBottom: 8, letterSpacing: "0.06em", textTransform: "uppercase" }}>output</div>
            <DiffText a={replay?.output} b={source.preview?.output || ""} side="a" />
          </div>
        </div>

        {/* REPLAY */}
        <div className="replay-col">
          <div className="colhd">
            <div className="lab">replay</div>
            <div className="now">
              {replay ? (
                <><span className="ptag" data-prov={replay.provider}><span className="swatch"></span>{replay.provider}</span> · <span className="mono" style={{ color: "var(--con-dim)" }}>{replay.model}</span>
                {replay.usedFallback && <span style={{ color: "var(--warn)", marginLeft: 8 }} className="mono">↘ fell back to mock</span>}
                </>
              ) : (
                <span className="mono" style={{ color: "var(--con-dim-2)" }}>idle</span>
              )}
            </div>
          </div>
          <div className="metrics">
            <div className="metric">
              <div className="ml">latency</div>
              <div className="mv">{replay ? fmtMs(replay.latencyMs) : "—"}</div>
              {replay && replay.status === "ok" && (
                <div className={"delta " + (latDelta > 0 ? "up" : "down")}>
                  {latDelta > 0 ? "+" : ""}{latDelta}ms vs original
                </div>
              )}
            </div>
            <div className="metric">
              <div className="ml">tokens p / c</div>
              <div className="mv" style={{ fontSize: 14 }}>{replay ? `${fmtTok(replay.promptTok)} / ${fmtTok(replay.completionTok)}` : "—"}</div>
            </div>
            <div className="metric">
              <div className="ml">cost</div>
              <div className="mv">{replay && repPrice ? fmtUSD(repPrice.total) : "—"}</div>
              {replay && repPrice && srcPrice && (
                <div className={"delta " + (costDelta > 0 ? "up" : "down")}>
                  {costDelta >= 0 ? "+" : ""}{fmtUSD(Math.abs(costDelta))} vs original
                </div>
              )}
            </div>
          </div>
          <div className="output">
            <div style={{ color: "var(--con-dim-2)", fontSize: 10.5, marginBottom: 8, letterSpacing: "0.06em", textTransform: "uppercase" }}>output{replay?.status === "streaming" && " · streaming"}</div>
            {replay ? (
              <DiffText a={replay.output} b={source.preview?.output || ""} side="b" streaming={replay.status === "streaming"} />
            ) : (
              <div className="pending">Hit “Run replay” to send this input to the selected provider.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SourceMenu({ source, eligible, onPick }) {
  const [open, setOpen] = useStateR(false);
  return (
    <div style={{ position: "relative" }}>
      <button className="source" onClick={() => setOpen((o) => !o)}>
        <StatusPill s={source.status} />
        <span className="ptag" data-prov={source.provider}><span className="swatch"></span>{source.provider}</span>
        <span style={{ color: "var(--con-dim)", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          “{source.preview?.input || "—"}”
        </span>
        <Icon name="arrow-down-right" size={10} />
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 19 }} onClick={() => setOpen(false)}></div>
          <div style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0,
            width: 460, maxHeight: 340, overflow: "auto",
            background: "var(--con-panel)", border: "1px solid var(--con-rule)",
            borderRadius: 6, padding: 6, zIndex: 20,
            boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
          }}>
            {[...eligible].reverse().map((t) => (
              <button key={t.id}
                      onClick={() => { onPick(t); setOpen(false); }}
                      style={{
                        display: "grid", gridTemplateColumns: "70px 100px 1fr 60px", gap: 10, alignItems: "center",
                        width: "100%", padding: "7px 9px", borderRadius: 4,
                        textAlign: "left", color: "var(--con-text)",
                        fontFamily: "'Geist Mono', monospace", fontSize: 11.5,
                        background: t.id === source.id ? "var(--con-panel-2)" : "transparent",
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "var(--con-hover)"}
                      onMouseLeave={(e) => e.currentTarget.style.background = t.id === source.id ? "var(--con-panel-2)" : "transparent"}>
                <StatusPill s={t.status} />
                <span className="ptag" data-prov={t.provider}><span className="swatch"></span>{t.provider}</span>
                <span style={{ color: "var(--con-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.preview?.input || "—"}
                </span>
                <span style={{ color: "var(--con-dim-2)", textAlign: "right" }}>{relTime(t.ts)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Word-level diff between source and replay outputs.
// side="a" → show source colored: removed-from-replay = del; common = plain.
// side="b" → show replay colored: added vs source = ins; common = plain.
function DiffText({ a, b, side, streaming }) {
  // a = replay text (may be partial), b = source text
  // For side "a" we show "source" with removals; for "b" we show "replay" with insertions.
  const sourceText = b || "";
  const replayText = a || "";
  const sw = tokenize(sourceText);
  const rw = tokenize(replayText);

  const diff = diffTokens(sw, rw);
  // diff items: {op:'eq'|'del'|'ins', text}
  if (side === "a") {
    return (
      <div>
        {diff.map((d, i) => {
          if (d.op === "ins") return null;
          if (d.op === "del") return <del key={i}>{d.text}</del>;
          return <span key={i}>{d.text}</span>;
        })}
      </div>
    );
  }
  return (
    <div>
      {diff.map((d, i) => {
        if (d.op === "del") return null;
        if (d.op === "ins") return <ins key={i}>{d.text}</ins>;
        return <span key={i}>{d.text}</span>;
      })}
      {streaming && <span style={{ display: "inline-block", width: 7, height: 14, background: "var(--acc)", marginLeft: 1, verticalAlign: "-2px", animation: "caret 1.1s steps(2) infinite" }}></span>}
    </div>
  );
}

function tokenize(s) {
  // split into words + whitespace runs so diff stays readable.
  return s.split(/(\s+|[.,!?;:()])/g).filter((x) => x !== "");
}

// Greedy LCS-style diff sufficient for short replies (O(n*m)).
function diffTokens(a, b) {
  const n = a.length, m = b.length;
  // For long texts, fall back to "all insert" to avoid quadratic blowup.
  if (n * m > 30000) {
    const out = [];
    if (a.length) out.push({ op: "del", text: a.join("") });
    if (b.length) out.push({ op: "ins", text: b.join("") });
    return out;
  }
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i+1][j+1] + 1;
      else dp[i][j] = Math.max(dp[i+1][j], dp[i][j+1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ op: "eq", text: a[i] }); i++; j++; }
    else if (dp[i+1][j] >= dp[i][j+1]) { out.push({ op: "del", text: a[i] }); i++; }
    else { out.push({ op: "ins", text: b[j] }); j++; }
  }
  while (i < n) { out.push({ op: "del", text: a[i++] }); }
  while (j < m) { out.push({ op: "ins", text: b[j++] }); }
  // merge consecutive same-op items
  const merged = [];
  for (const item of out) {
    const last = merged.at(-1);
    if (last && last.op === item.op) last.text += item.text;
    else merged.push({ ...item });
  }
  return merged;
}

function Spinner() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" style={{ animation: "spin 0.9s linear infinite" }}>
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="14 40"></circle>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}

function chunkReplay(s, n) {
  const out = [];
  const words = s.split(/(\s+)/);
  let cur = "";
  for (const w of words) {
    cur += w;
    if (cur.length >= n) { out.push(cur); cur = ""; }
  }
  if (cur) out.push(cur);
  return out;
}

function cannedReplayReply(input) {
  if (/cost|spend|bill/i.test(input))
    return "Three highest-leverage moves: route low-stakes traffic to the smallest capable model, cache shared system prompts at the gateway, and enforce a per-surface completion cap. Replay each change against last week's traffic in this tab before you ship.";
  if (/launch|announce/i.test(input))
    return "Three beats only: the thing, the audience, the quote. Cut anything that sounds like a brochure. End with one clear ask.";
  if (/haiku|poem/i.test(input))
    return "log lines, like raindrops\nfall in even cadences\nthe service answers";
  if (/pricing|tier/i.test(input))
    return "Anchor on the middle tier visually. Make the top tier feel procurement-shaped (contact us, SAML, SLA). Keep the entry tier so cheap it removes the decision.";
  return "Got it — here's an alternate take from this provider. The shape of the answer stays close, but the wording differs; that's the diff this tab is built to surface.";
}

Object.assign(window, { ReplayTab });
