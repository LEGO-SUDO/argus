// chat.jsx — calm, premium chat surface
// - Conversation list (sidebar)
// - Streaming responses via window.claude.complete (chunked locally)
// - Provider chip per turn (with failover note when applicable)
// - Cancel mid-stream
// - All turns produce traces in the shared store

const { useState: useStateC, useEffect: useEffectC, useRef: useRefC, useLayoutEffect, useMemo: useMemoC } = React;

const STARTERS = [
  { title: "Help me draft a reply",        sub: "to a customer asking for a refund" },
  { title: "Summarize this thread",        sub: "in 5 bullet points, no fluff" },
  { title: "Cost down our LLM bill",       sub: "ideas for cutting spend 30%" },
  { title: "Write a launch announcement",  sub: "for a small B2B product" },
];

// Pick a provider for the next turn — most calls go to the configured default (mock),
// but we deterministically rotate so the demo shows multi-provider data.
function pickProviderForTurn(convId, turnIx, providersEnabled) {
  const seed = (convId.charCodeAt(convId.length - 1) || 7) + turnIx;
  const cycle = providersEnabled.length ? providersEnabled : ["mock"];
  return cycle[seed % cycle.length];
}

// Should this turn demo a failover? Rare, deterministic.
function shouldFailover(convId, turnIx) {
  return (turnIx + (convId.charCodeAt(0) || 0)) % 7 === 3;
}

function ChatSurface({ providersEnabled, streamMs }) {
  const store = useStore();
  const { user, convs, appendMessage, patchMessage, addTrace, patchTrace,
          activeConvId, setActiveConvId, route, setRoute, upsertConv } = store;

  const activeConv = useMemoC(
    () => convs.find((c) => c.id === activeConvId) || null,
    [convs, activeConvId]
  );

  // Streaming controller (per active turn)
  const cancelRef = useRefC(null); // { canceled: bool, msgId, traceId, convId }
  const [streaming, setStreaming] = useStateC(false);

  // Group convs by date bucket
  const grouped = useMemoC(() => {
    const today = [], yesterday = [], earlier = [];
    const now = Date.now();
    for (const c of convs) {
      const age = now - (c.messages.at(-1)?.t ?? c.created);
      if (age < 1000 * 60 * 60 * 18)       today.push(c);
      else if (age < 1000 * 60 * 60 * 42)  yesterday.push(c);
      else                                 earlier.push(c);
    }
    return { today, yesterday, earlier };
  }, [convs]);

  const newConversation = () => {
    if (streaming) return;
    setActiveConvId(null);
  };

  // Auto-scroll on new content
  const scrollRef = useRefC(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [activeConv?.messages, streaming]);

  const sendMessage = async (text) => {
    if (!text.trim() || streaming) return;

    // Create or reuse conversation.
    let conv = activeConv;
    if (!conv) {
      conv = {
        id: newId("conv"),
        title: text.length > 48 ? text.slice(0, 46).trim() + "…" : text,
        created: Date.now(),
        messages: [],
      };
      upsertConv(conv);
      setActiveConvId(conv.id);
    }

    const userMsg = { id: newId("m"), role: "user", text, t: Date.now() };
    appendMessage(conv.id, userMsg);

    // Pick provider + model
    const turnIx = conv.messages.length;
    const provider = pickProviderForTurn(conv.id, turnIx, providersEnabled);
    const model    = DEFAULT_MODEL_FOR[provider];
    const failover = shouldFailover(conv.id, turnIx);

    const asstMsgId = newId("m");
    const traceId   = newId("trc");

    const assistantMsg = {
      id: asstMsgId, role: "assistant", text: "", t: Date.now(),
      status: "streaming", provider, model, traceId,
      failoverFrom: failover ? "openai" : null,
    };
    appendMessage(conv.id, assistantMsg);

    // Open a trace immediately ("near-real-time")
    addTrace({
      id: traceId,
      ts: Date.now(),
      provider, model,
      status: "streaming",
      latencyMs: 0,
      ttftMs: 0,
      promptTok: estimateTokens(text) + estimateTokens(conv.messages.map((m) => m.text).join(" ")),
      completionTok: 0,
      conversationId: conv.id,
      turnId: asstMsgId,
      preview: { input: text, output: "" },
      failoverFrom: failover ? "openai" : null,
    });

    // Build prompt: use conversation history + a system note.
    const history = [
      ...conv.messages.filter((m) => m.role !== "assistant" || m.status !== "streaming"),
      userMsg,
    ];

    const cancelCtl = { canceled: false, msgId: asstMsgId, traceId, convId: conv.id };
    cancelRef.current = cancelCtl;
    setStreaming(true);

    const startedAt = performance.now();
    let firstTokenAt = null;

    let full = "";
    try {
      // Real model call via the built-in helper.
      // It returns the full string; we'll chunk it locally to mimic streaming.
      const messages = history.map((m) => ({
        role: m.role,
        content: m.text,
      }));
      // Prepend a tiny system nudge so responses fit the surface.
      messages.unshift({
        role: "user",
        content:
          "[argus system context — be concise, friendly, and concrete; aim for 1–3 short paragraphs unless asked for length. Plain text, no markdown headings.]\n\n" +
          (messages.shift().content || ""),
      });

      const responsePromise = window.claude.complete({ messages });
      // soft timeout — fall back to a canned reply if helper is slow/unavailable.
      const guarded = await Promise.race([
        responsePromise,
        new Promise((res) => setTimeout(() => res(null), 18000)),
      ]);

      full = (guarded && typeof guarded === "string" && guarded.trim())
        ? guarded.trim()
        : cannedReply(text);
    } catch (e) {
      full = cannedReply(text);
    }

    // Local chunked reveal — splits into ~3-char chunks to simulate token stream.
    const chunks = chunk(full, 3);
    for (let i = 0; i < chunks.length; i++) {
      if (cancelCtl.canceled) break;
      if (firstTokenAt == null) firstTokenAt = performance.now();
      const partial = chunks.slice(0, i + 1).join("");
      patchMessage(conv.id, asstMsgId, { text: partial });
      patchTrace(traceId, {
        preview: { input: text, output: partial.slice(0, 200) },
        completionTok: estimateTokens(partial),
      });
      // pace the stream
      await sleep(streamMs);
    }

    const ended = performance.now();
    const wasCanceled = cancelCtl.canceled;
    const finalText = wasCanceled
      ? chunks.slice(0, Math.max(1, Math.floor((chunks.length * (ended - startedAt) - 0) / (chunks.length * streamMs)))).join("")
      : full;

    patchMessage(conv.id, asstMsgId, {
      text: finalText,
      status: wasCanceled ? "canceled" : "ok",
    });
    patchTrace(traceId, {
      status: wasCanceled ? "canceled" : "ok",
      latencyMs: Math.round(ended - startedAt),
      ttftMs:    firstTokenAt ? Math.round(firstTokenAt - startedAt) : 0,
      completionTok: estimateTokens(finalText),
      preview: { input: text, output: finalText.slice(0, 200) },
    });

    cancelRef.current = null;
    setStreaming(false);
  };

  const cancel = () => {
    if (cancelRef.current) cancelRef.current.canceled = true;
  };

  return (
    <div className="surface-chat">
      <ChatSidebar
        user={user}
        grouped={grouped}
        activeId={activeConvId}
        streaming={streaming}
        onPick={(id) => !streaming && setActiveConvId(id)}
        onNew={newConversation}
        onSignOut={store.onSignOut /* set in App */}
      />

      <main className="chat-main">
        <header className="chat-topbar">
          <div className="conv-title">
            {activeConv ? (
              <><b>{activeConv.title}</b></>
            ) : (
              <span style={{ color: "var(--chat-ink-3)" }}>New conversation</span>
            )}
          </div>
          <SurfaceSwitch route={route} setRoute={setRoute} traceCount={store.traces.length} />
        </header>

        <div className="chat-scroll" ref={scrollRef}>
          {!activeConv ? (
            <ChatHero onPick={(s) => sendMessage(s)} />
          ) : (
            <ChatConversation
              conv={activeConv}
              streaming={streaming}
              streamingMsgId={cancelRef.current?.msgId}
              onOpenTrace={(traceId) => setRoute({ surface: "console", tab: "traces", traceId, replayId: null })}
              onRetry={() => {
                const last = activeConv.messages.findLast?.((m) => m.role === "user");
                if (last) sendMessage(last.text);
              }}
            />
          )}
        </div>

        <Composer
          disabled={streaming}
          streaming={streaming}
          onSend={sendMessage}
          onCancel={cancel}
          providersEnabled={providersEnabled}
        />
      </main>
    </div>
  );
}

/* ── pieces ──────────────────────────────────────────────────────────── */

function SurfaceSwitch({ route, setRoute, traceCount }) {
  return (
    <div className="surface-switch" role="tablist">
      <button
        className={route.surface === "chat" ? "active" : ""}
        onClick={() => setRoute({ ...route, surface: "chat" })}
      >
        /chat
      </button>
      <button
        className={route.surface === "console" ? "active" : ""}
        onClick={() => setRoute({ ...route, surface: "console" })}
      >
        /console <span className="mono" style={{ opacity: 0.6, marginLeft: 4 }}>{traceCount}</span>
      </button>
    </div>
  );
}

function ChatSidebar({ user, grouped, activeId, streaming, onPick, onNew, onSignOut }) {
  return (
    <aside className="chat-side">
      <div className="head">
        <BrandMark />
      </div>
      <button className="new-btn" onClick={onNew} disabled={streaming}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Icon name="plus" size={13} /> New conversation
        </span>
        <kbd>⌘N</kbd>
      </button>

      <div className="list">
        {grouped.today.length > 0 && (<>
          <div className="group-label">Today</div>
          {grouped.today.map((c) => (
            <button key={c.id} className={"item" + (c.id === activeId ? " active" : "")} onClick={() => onPick(c.id)}>
              {c.title}
            </button>
          ))}
        </>)}
        {grouped.yesterday.length > 0 && (<>
          <div className="group-label">Yesterday</div>
          {grouped.yesterday.map((c) => (
            <button key={c.id} className={"item" + (c.id === activeId ? " active" : "")} onClick={() => onPick(c.id)}>
              {c.title}
            </button>
          ))}
        </>)}
        {grouped.earlier.length > 0 && (<>
          <div className="group-label">Earlier</div>
          {grouped.earlier.map((c) => (
            <button key={c.id} className={"item" + (c.id === activeId ? " active" : "")} onClick={() => onPick(c.id)}>
              {c.title}
            </button>
          ))}
        </>)}
      </div>

      <div className="foot">
        <div className="user-chip">
          <span className="avatar">{user.email.slice(0, 2).toUpperCase()}</span>
          <span className="email">{user.email}</span>
        </div>
        <button className="iconbtn" title="Sign out" onClick={onSignOut}><Icon name="logout" size={14} /></button>
      </div>
    </aside>
  );
}

function ChatHero({ onPick }) {
  return (
    <div className="chat-hero">
      <div className="eyebrow">argus · mock provider on</div>
      <h1>How can I <em>help</em> today?</h1>
      <p>
        Type a message below to start a new thread. Every turn streams in real time and is
        captured to the inference log — open <span className="mono" style={{ fontSize: 13 }}>/console</span> to inspect, replay, or compare across providers.
      </p>
      <div className="starters">
        {STARTERS.map((s, i) => (
          <button key={i} className="starter" onClick={() => onPick(s.title + " " + s.sub)}>
            {s.title}
            <div className="sub">{s.sub}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ChatConversation({ conv, streaming, streamingMsgId, onOpenTrace, onRetry }) {
  const msgs = conv.messages;
  // Insert a context-overflow indicator if there are >12 messages.
  const overflowAt = msgs.length > 12 ? msgs.length - 10 : -1;

  return (
    <div className="chat-conv">
      {msgs.map((m, i) => (
        <React.Fragment key={m.id}>
          {i === overflowAt && (
            <div className="context-banner mono">
              {overflowAt} earlier messages omitted from context
            </div>
          )}
          <Message
            m={m}
            isStreaming={streaming && m.id === streamingMsgId}
            onOpenTrace={onOpenTrace}
            onRetry={onRetry}
          />
        </React.Fragment>
      ))}
    </div>
  );
}

function Message({ m, isStreaming, onOpenTrace, onRetry }) {
  if (m.role === "user") {
    return (
      <div className="msg user">
        <div className="meta">
          <span className="role">you</span>
        </div>
        <div className="body">{m.text}</div>
      </div>
    );
  }
  // assistant
  const interrupted = m.status === "canceled";
  return (
    <div className={"msg assistant" + (interrupted ? " interrupted" : "")}>
      <div className="meta">
        <span className="role">assistant</span>
        <span className="dot">·</span>
        <span className="prov" data-prov={m.provider}>
          <span className="swatch"></span>
          <span className="mono">{PROVIDER_LABEL[m.provider]?.toLowerCase?.() || m.provider}</span>
          <span style={{ color: "var(--chat-ink-3)" }} className="mono">/{m.model}</span>
        </span>
        {m.failoverFrom && (
          <>
            <span className="dot">·</span>
            <span className="mono" style={{ color: "var(--warn)", fontSize: 10.5 }}>
              ↻ failed over from {m.failoverFrom}
            </span>
          </>
        )}
      </div>
      <div className="body">
        {m.text || (isStreaming ? <span style={{ color: "var(--chat-ink-3)" }}>…</span> : null)}
        {isStreaming && <span className="caret" />}
      </div>
      {!isStreaming && m.status === "canceled" && (
        <div className="retry-inline">
          <button onClick={onRetry}>Retry</button>
        </div>
      )}
      {!isStreaming && m.traceId && (
        <div className="actions">
          <button onClick={() => onOpenTrace(m.traceId)}>
            <Icon name="external" size={11} /> view trace
          </button>
          <button>
            <Icon name="copy" size={11} /> copy
          </button>
        </div>
      )}
    </div>
  );
}

function Composer({ disabled, streaming, onSend, onCancel, providersEnabled }) {
  const [val, setVal] = useStateC("");
  const taRef = useRefC(null);

  useEffectC(() => {
    if (!taRef.current) return;
    taRef.current.style.height = "auto";
    taRef.current.style.height = Math.min(220, taRef.current.scrollHeight) + "px";
  }, [val]);

  const submit = () => {
    if (disabled) return;
    onSend(val);
    setVal("");
  };

  return (
    <div className="composer-wrap">
      <div className="composer">
        <textarea
          ref={taRef}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder={streaming ? "Streaming response… cancel to send another" : "Message argus…"}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
          disabled={streaming}
          rows={1}
        />
        <div className="row2">
          <div className="left-chips">
            <span className="pill">
              <span className="prov" data-prov="mock"><span className="swatch"></span></span>
              mock · auto-failover
            </span>
            <span className="pill" style={{ color: "var(--chat-ink-3)" }}>
              {providersEnabled.length} providers enabled
            </span>
          </div>
          {streaming ? (
            <button className="send cancel" onClick={onCancel}>
              <Icon name="stop" size={11} /> Cancel
            </button>
          ) : (
            <button className="send" onClick={submit} disabled={!val.trim()}>
              Send <Icon name="arrow-up" size={11} />
            </button>
          )}
        </div>
      </div>
      <div className="help">
        <kbd>⏎</kbd> to send · <kbd>⇧</kbd>+<kbd>⏎</kbd> for newline
      </div>
    </div>
  );
}

/* ── helpers ─────────────────────────────────────────────────────────── */

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function chunk(s, n) {
  const out = [];
  // chunk by word boundaries when possible so the "stream" reads naturally
  const words = s.split(/(\s+)/);
  let cur = "";
  for (const w of words) {
    cur += w;
    if (cur.length >= n) { out.push(cur); cur = ""; }
  }
  if (cur) out.push(cur);
  return out;
}

function cannedReply(input) {
  // Used only if the helper fails or times out.
  if (/cost|spend|bill/i.test(input))
    return "Three levers that move the needle most: route cheap traffic to a smaller model, cache common system prompts, and cap completion length per surface. Measure each in /console → Cost; the Replay tab lets you re-run a recent inference against a cheaper provider to see the delta before you ship.";
  if (/launch|announce/i.test(input))
    return "Keep the announcement to three beats: the thing, who it's for, and the one quote that makes the reader feel something. Skip the company history. End with the single action you want them to take.";
  if (/haiku|poem/i.test(input))
    return "logs scroll like a tide\neach call a thin paper boat\nyou watch them set out";
  return "Got it — here's a quick take. (This is the canned mock-provider reply; with a real API key configured the response comes from the live provider chosen for this turn.) Open /console to see the trace for this call land in real time.";
}

Object.assign(window, { ChatSurface });
