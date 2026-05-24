// console.jsx — operator console
// Three tabs: Traces, Cost, Replay — all reading from the same store.

const { useState: useStateO, useMemo: useMemoO, useEffect: useEffectO, useRef: useRefO } = React;

function ConsoleSurface({ providersEnabled, streamMs }) {
  const store = useStore();
  const { route, setRoute, traces } = store;

  // newest trace -> "new-row" flash class for ~2s
  const [flashIds, setFlashIds] = useStateO(new Set());
  const lastSeenRef = useRefO(traces.length);
  useEffectO(() => {
    if (traces.length > lastSeenRef.current) {
      const fresh = traces.slice(lastSeenRef.current).map((t) => t.id);
      setFlashIds((s) => new Set([...s, ...fresh]));
      const t = setTimeout(() => setFlashIds((s) => {
        const n = new Set(s); fresh.forEach((id) => n.delete(id)); return n;
      }), 2500);
      lastSeenRef.current = traces.length;
      return () => clearTimeout(t);
    }
  }, [traces.length]);

  const setTab = (tab) => setRoute({ ...route, tab, traceId: null });

  return (
    <div className="surface-console">
      <ConsoleSidebar store={store} />

      <main className="con-main">
        <header className="con-topbar">
          <div className="tabs">
            <button className={"tab" + (route.tab === "traces" ? " active" : "")} onClick={() => setTab("traces")}>
              <Icon name="list" size={13} /> Traces
              <span className="badge">{traces.length}</span>
            </button>
            <button className={"tab" + (route.tab === "cost" ? " active" : "")} onClick={() => setTab("cost")}>
              <Icon name="dollar" size={13} /> Cost
            </button>
            <button className={"tab" + (route.tab === "replay" ? " active" : "")} onClick={() => setTab("replay")}>
              <Icon name="replay" size={13} /> Replay
            </button>
          </div>
          <div className="right">
            <span className="live-pill">
              <span className="dot"></span> live · behind by &lt;1s
            </span>
            <SurfaceSwitchConsole route={route} setRoute={setRoute} />
          </div>
        </header>

        {route.tab === "traces" && <TracesTab flashIds={flashIds} />}
        {route.tab === "cost"   && <CostTab />}
        {route.tab === "replay" && <ReplayTab providersEnabled={providersEnabled} streamMs={streamMs} />}
      </main>

      {route.traceId && <TraceDrawer traceId={route.traceId} onClose={() => setRoute({ ...route, traceId: null })} />}
    </div>
  );
}

function SurfaceSwitchConsole({ route, setRoute }) {
  return (
    <div className="surface-switch" style={{ background: "var(--con-panel)", border: "1px solid var(--con-rule)" }}>
      <button
        className={route.surface === "chat" ? "active" : ""}
        style={{ color: route.surface === "chat" ? "var(--con-text)" : "var(--con-dim)" }}
        onClick={() => setRoute({ ...route, surface: "chat" })}
      >/chat</button>
      <button
        className={route.surface === "console" ? "active" : ""}
        style={{
          color: route.surface === "console" ? "var(--con-text)" : "var(--con-dim)",
          background: route.surface === "console" ? "var(--con-panel-2)" : "transparent",
        }}
        onClick={() => setRoute({ ...route, surface: "console" })}
      >/console</button>
    </div>
  );
}

function ConsoleSidebar({ store }) {
  const { route, setRoute, traces, convs, user, onSignOut } = store;
  const counts = useMemoO(() => {
    const c = { ok: 0, failed: 0, canceled: 0, timeout: 0, streaming: 0 };
    for (const t of traces) c[t.status] = (c[t.status] ?? 0) + 1;
    return c;
  }, [traces]);

  return (
    <aside className="con-side">
      <div className="head"><BrandMark /></div>
      <div className="section-label">Lenses</div>
      <div className="navlist">
        <button className={"nav" + (route.tab === "traces" ? " active" : "")} onClick={() => setRoute({ ...route, tab: "traces", traceId: null })}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Icon name="list" size={13} /> traces
          </span>
          <span className="count">{traces.length}</span>
        </button>
        <button className={"nav" + (route.tab === "cost" ? " active" : "")} onClick={() => setRoute({ ...route, tab: "cost", traceId: null })}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Icon name="dollar" size={13} /> cost
          </span>
        </button>
        <button className={"nav" + (route.tab === "replay" ? " active" : "")} onClick={() => setRoute({ ...route, tab: "replay", traceId: null })}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Icon name="replay" size={13} /> replay
          </span>
        </button>
      </div>

      <div className="section-label">Status</div>
      <div className="navlist">
        <div className="nav"><span><span className="pdot" style={{ background: "var(--ok)", display: "inline-block", width: 6, height: 6, borderRadius: "50%", marginRight: 8 }}></span>ok</span><span className="count">{counts.ok || 0}</span></div>
        <div className="nav"><span><span style={{ background: "var(--err)", display: "inline-block", width: 6, height: 6, borderRadius: "50%", marginRight: 8 }}></span>failed</span><span className="count">{(counts.failed || 0) + (counts.timeout || 0)}</span></div>
        <div className="nav"><span><span style={{ background: "var(--con-dim)", display: "inline-block", width: 6, height: 6, borderRadius: "50%", marginRight: 8 }}></span>canceled</span><span className="count">{counts.canceled || 0}</span></div>
      </div>

      <div className="section-label">Providers</div>
      <div className="navlist">
        {["openai", "anthropic", "gemini", "mock"].map((p) => {
          const n = traces.filter((t) => t.provider === p).length;
          return (
            <div key={p} className="nav">
              <span><span style={{ background: `var(--p-${p})`, display: "inline-block", width: 6, height: 6, borderRadius: "50%", marginRight: 8 }}></span>{p}</span>
              <span className="count">{n}</span>
            </div>
          );
        })}
      </div>

      <div className="foot">
        <div className="user-chip">
          <span className="avatar">{user.email.slice(0, 2).toUpperCase()}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{user.email}</span>
        </div>
        <button className="iconbtn" title="Sign out" onClick={onSignOut}><Icon name="logout" size={13} /></button>
      </div>
    </aside>
  );
}

/* ── TRACES TAB ──────────────────────────────────────────────────────── */

function TracesTab({ flashIds }) {
  const store = useStore();
  const { traces, route, setRoute, convs } = store;
  const [statusFilter, setStatusFilter] = useStateO(null);
  const [providerFilter, setProviderFilter] = useStateO(null);
  const [q, setQ] = useStateO("");

  const rows = useMemoO(() => {
    let r = [...traces].sort((a, b) => b.ts - a.ts);
    if (statusFilter)   r = r.filter((t) => t.status === statusFilter);
    if (providerFilter) r = r.filter((t) => t.provider === providerFilter);
    if (q.trim())       r = r.filter((t) => (t.preview?.input || "").toLowerCase().includes(q.toLowerCase()));
    return r;
  }, [traces, statusFilter, providerFilter, q]);

  // metrics for stat strip
  const stats = useMemoO(() => {
    const ok = traces.filter((t) => t.status === "ok");
    const p50 = quantile(ok.map((t) => t.latencyMs), 0.5);
    const p95 = quantile(ok.map((t) => t.latencyMs), 0.95);
    const totalCost = traces.reduce((s, t) => {
      const p = priceFor(t);
      return s + (p ? p.total : 0);
    }, 0);
    const errPct = traces.length
      ? 100 * (traces.filter((t) => t.status === "failed" || t.status === "timeout").length / traces.length)
      : 0;
    return { p50, p95, totalCost, errPct, total: traces.length };
  }, [traces]);

  // sparkline of last 30 latencies
  const sparkLat = useMemoO(() => {
    const last = traces.slice(-30).filter((t) => t.status === "ok").map((t) => t.latencyMs);
    return last.length > 1 ? last : [600, 700, 650];
  }, [traces]);
  const sparkRate = useMemoO(() => {
    const last = traces.slice(-30);
    return last.length > 1 ? last.map((_, i) => i + 1) : [1, 2];
  }, [traces]);

  if (traces.length === 0) {
    return (
      <div className="empty">
        <div className="card">
          <div className="glyph"><Icon name="list" size={16} /></div>
          <h3>No traces yet</h3>
          <p>Send a message in /chat — the inference will appear here within ~5 seconds.</p>
          <button className="cta" onClick={() => store.setRoute({ ...store.route, surface: "chat" })}>
            Open /chat <Icon name="arrow-right" size={11} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="con-statrow">
        <Stat label="inferences (24h)" val={stats.total} spark={sparkRate} sparkColor="var(--acc)" />
        <Stat label="latency p50"      val={stats.p50}  unit="ms" spark={sparkLat} sparkColor="var(--p-anthropic)" fill />
        <Stat label="latency p95"      val={stats.p95}  unit="ms" delta={`+${Math.round(stats.p95 - stats.p50)}ms vs p50`} />
        <Stat label="error rate"
              val={stats.errPct.toFixed(1)} unit="%"
              delta={stats.errPct > 5 ? `above SLO (5%)` : `within SLO`}
              deltaClass={stats.errPct > 5 ? "down" : "up"}
        />
      </div>

      <div className="con-tools">
        <FilterChip label={`status: ${statusFilter || "any"}`} active={!!statusFilter}
          onClick={() => setStatusFilter(cycle(["ok", "failed", "canceled", "timeout", null], statusFilter))} />
        <FilterChip label={`provider: ${providerFilter || "any"}`} active={!!providerFilter}
          onClick={() => setProviderFilter(cycle(["openai", "anthropic", "gemini", "mock", null], providerFilter))} />
        <div className="con-search">
          <Icon name="search" size={12} />
          <input placeholder="search input previews…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="spacer" />
        <div className="window-switch">
          <button className="active">24h</button>
          <button>7d</button>
          <button>all</button>
        </div>
      </div>

      <div className="con-tablewrap">
        <table className="con-table">
          <thead>
            <tr>
              <th style={{ width: 60 }}>status</th>
              <th>provider · model</th>
              <th>input preview</th>
              <th className="num" style={{ width: 90 }}>ttft</th>
              <th className="num" style={{ width: 90 }}>latency</th>
              <th className="num" style={{ width: 120 }}>tokens (p/c)</th>
              <th className="num" style={{ width: 90 }}>cost</th>
              <th className="num" style={{ width: 90 }}>when</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const p = priceFor(t);
              return (
                <tr key={t.id}
                    className={flashIds.has(t.id) ? "new-row" : ""}
                    onClick={() => setRoute({ ...route, traceId: t.id })}>
                  <td><StatusPill s={t.status} /></td>
                  <td>
                    <span className="ptag" data-prov={t.provider}>
                      <span className="swatch"></span>
                      <span>{t.provider}</span>
                      <span className="model">{t.model}</span>
                    </span>
                    {t.failoverFrom && (
                      <div style={{ fontSize: 10.5, color: "var(--warn)", marginTop: 2 }} className="mono">
                        ↻ failover from {t.failoverFrom}
                      </div>
                    )}
                  </td>
                  <td className="dim" style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {(t.preview?.input || "—").slice(0, 80)}{(t.preview?.input || "").length > 80 ? "…" : ""}
                  </td>
                  <td className="num dim">{t.status === "ok" ? fmtMs(t.ttftMs) : "—"}</td>
                  <td className="num">{fmtMs(t.latencyMs)}</td>
                  <td className="num dim">
                    <span style={{ color: "var(--con-text)" }}>{fmtTok(t.promptTok)}</span>
                    <span> · </span>
                    <span style={{ color: "var(--con-text)" }}>{fmtTok(t.completionTok)}</span>
                  </td>
                  <td className="num">{p ? fmtUSD(p.total) : <span className="dim">—</span>}</td>
                  <td className="num ts">{relTime(t.ts)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Stat({ label, val, unit, delta, deltaClass, spark, sparkColor, fill }) {
  return (
    <div className="con-stat">
      <div className="lbl">{label}</div>
      <div className="val">
        {val}
        {unit && <span className="unit">{unit}</span>}
      </div>
      {delta && <div className={"delta" + (deltaClass ? " " + deltaClass : "")}>{delta}</div>}
      {spark && <Sparkline data={spark} color={sparkColor || "var(--acc)"} width={200} height={22} fill={fill} />}
    </div>
  );
}

function FilterChip({ label, active, onClick }) {
  return (
    <button className={"filter-chip" + (active ? " active" : "")} onClick={onClick}>
      <Icon name="filter" size={10} /> {label}
    </button>
  );
}

function StatusPill({ s }) {
  if (s === "streaming") return <span className="pill streaming"><span className="pdot"></span>streaming</span>;
  if (s === "ok")       return <span className="pill ok"><span className="pdot"></span>ok</span>;
  if (s === "failed")   return <span className="pill err"><span className="pdot"></span>failed</span>;
  if (s === "timeout")  return <span className="pill err"><span className="pdot"></span>timeout</span>;
  if (s === "canceled") return <span className="pill cancel"><span className="pdot"></span>canceled</span>;
  return <span className="pill">{s}</span>;
}

function cycle(arr, cur) {
  const i = arr.indexOf(cur);
  return arr[(i + 1) % arr.length];
}
function quantile(arr, q) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.floor(q * s.length));
  return Math.round(s[i]);
}

/* ── TRACE DRAWER ────────────────────────────────────────────────────── */

function TraceDrawer({ traceId, onClose }) {
  const store = useStore();
  const trace = store.traces.find((t) => t.id === traceId);
  if (!trace) return null;
  const p = priceFor(trace);
  const replayable = trace.status !== "canceled" && trace.status !== "streaming";

  return (
    <>
      <div className="drawer-mask" onClick={onClose}></div>
      <aside className="drawer">
        <div className="dhd">
          <div>
            <div className="title">trace · {trace.provider} · {trace.model}</div>
            <div className="id">{trace.id}  ·  turn {trace.turnId?.slice(0, 10)}…</div>
          </div>
          <div className="actions">
            {replayable && (
              <button className="replay" onClick={() => store.setRoute({ ...store.route, tab: "replay", replayId: trace.id, traceId: null })}>
                <Icon name="replay" size={11} /> replay
              </button>
            )}
            <button onClick={onClose}><Icon name="x" size={12} /></button>
          </div>
        </div>
        <div className="dbody">
          <section>
            <div className="panel-title">summary</div>
            <dl className="kv">
              <dt>status</dt><dd><StatusPill s={trace.status} /></dd>
              <dt>provider</dt><dd>{PROVIDER_LABEL[trace.provider]} ({trace.provider})</dd>
              <dt>model</dt><dd>{trace.model}</dd>
              <dt>conversation</dt><dd>{trace.conversationId || "—"}</dd>
              <dt>turn id</dt><dd>{trace.turnId || "—"}</dd>
              <dt>started</dt><dd>{new Date(trace.ts).toLocaleString()}</dd>
              {trace.failoverFrom && (<><dt>failover from</dt><dd style={{ color: "var(--warn)" }}>{trace.failoverFrom}</dd></>)}
              {trace.errorCode && (<><dt>error</dt><dd style={{ color: "var(--err)" }}>{trace.errorCode}</dd></>)}
            </dl>
          </section>

          <section>
            <div className="panel-title">timeline</div>
            <Timeline trace={trace} />
          </section>

          <section>
            <div className="panel-title">tokens & cost</div>
            <dl className="kv">
              <dt>prompt tokens</dt><dd>{fmtTok(trace.promptTok)}</dd>
              <dt>completion tokens</dt><dd>{fmtTok(trace.completionTok)}</dd>
              <dt>total tokens</dt><dd>{fmtTok((trace.promptTok || 0) + (trace.completionTok || 0))}</dd>
              <dt>prompt cost</dt><dd>{p ? fmtUSD(p.prompt) : <span style={{ color: "var(--con-dim)" }}>— (no pricing entry)</span>}</dd>
              <dt>completion cost</dt><dd>{p ? fmtUSD(p.completion) : "—"}</dd>
              <dt>total cost</dt><dd>{p ? fmtUSD(p.total) : "—"}</dd>
            </dl>
          </section>

          <section>
            <div className="panel-title">input</div>
            <div className="codepane">{trace.preview?.input || "—"}</div>
          </section>

          <section>
            <div className="panel-title">output</div>
            <div className={"codepane" + (trace.preview?.output ? "" : " dim")}>
              {trace.preview?.output || "(no output recorded)"}
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}

function Timeline({ trace }) {
  const total = Math.max(1, trace.latencyMs || 1);
  const ttft  = trace.ttftMs || 0;
  const queue = Math.round(Math.min(120, ttft * 0.3));
  const network = Math.round(Math.min(80, ttft * 0.15));
  const inference = Math.max(0, ttft - queue - network);
  const stream = Math.max(0, total - ttft);
  const max = total;

  const rows = [
    { label: "queue",        ms: queue,    },
    { label: "network",      ms: network,  },
    { label: "prompt eval",  ms: inference,},
    { label: "stream",       ms: stream,   },
  ];
  return (
    <div className="timeline">
      {rows.map((r) => (
        <div className="row" key={r.label}>
          <span className="label">{r.label}</span>
          <span className="bar" style={{ width: `${Math.max(2, (r.ms / max) * 100)}%` }}></span>
          <span className="ms">{fmtMs(r.ms)}</span>
        </div>
      ))}
    </div>
  );
}

/* ── COST TAB ────────────────────────────────────────────────────────── */

function CostTab() {
  const store = useStore();
  const { traces, route, setRoute } = store;
  const [win, setWin] = useStateO("24h");

  // Build per-hour buckets across last 24 hours, stacked by provider.
  const buckets = useMemoO(() => {
    const hours = 24;
    const now = Date.now();
    const start = now - hours * 3600 * 1000;
    const buckets = Array.from({ length: hours }, () => ({ openai: 0, anthropic: 0, gemini: 0, mock: 0 }));
    for (const t of traces) {
      if (t.ts < start) continue;
      const p = priceFor(t);
      if (!p) continue;
      const idx = Math.min(hours - 1, Math.max(0, Math.floor((t.ts - start) / 3600 / 1000)));
      buckets[idx][t.provider] = (buckets[idx][t.provider] || 0) + p.total;
    }
    return buckets;
  }, [traces]);

  // Breakdown by model
  const byModel = useMemoO(() => {
    const map = new Map();
    for (const t of traces) {
      const p = priceFor(t);
      const key = `${t.provider}|${t.model}`;
      const v = map.get(key) || { provider: t.provider, model: t.model, calls: 0, promptTok: 0, completionTok: 0, prompt: 0, completion: 0, total: 0, missing: !p };
      v.calls += 1;
      v.promptTok     += t.promptTok || 0;
      v.completionTok += t.completionTok || 0;
      if (p) { v.prompt += p.prompt; v.completion += p.completion; v.total += p.total; }
      map.set(key, v);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [traces]);

  const byConv = useMemoO(() => {
    const map = new Map();
    for (const t of traces) {
      const p = priceFor(t);
      const key = t.conversationId || "(unknown)";
      const v = map.get(key) || { conv: key, calls: 0, total: 0 };
      v.calls += 1;
      if (p) v.total += p.total;
      map.set(key, v);
    }
    return [...map.values()].sort((a, b) => b.total - a.total).slice(0, 6);
  }, [traces]);

  const maxBucket = Math.max(0.001, ...buckets.map((b) => b.openai + b.anthropic + b.gemini + b.mock));
  const totalSpend = buckets.reduce((s, b) => s + b.openai + b.anthropic + b.gemini + b.mock, 0);

  if (traces.length === 0) {
    return (
      <div className="empty">
        <div className="card">
          <div className="glyph"><Icon name="dollar" size={16} /></div>
          <h3>Cost tab is empty</h3>
          <p>Send a few messages in /chat — spend tallies as inferences land.</p>
          <button className="cta" onClick={() => store.setRoute({ ...store.route, surface: "chat" })}>
            Open /chat <Icon name="arrow-right" size={11} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="con-statrow">
        <div className="con-stat">
          <div className="lbl">spend ({win})</div>
          <div className="val">{fmtUSD(totalSpend)}<span className="unit">usd</span></div>
          <div className="delta">priced against snapshot 2026-05-23</div>
        </div>
        <div className="con-stat">
          <div className="lbl">inferences</div>
          <div className="val">{traces.length}</div>
          <div className="delta">mock contributes $0</div>
        </div>
        <div className="con-stat">
          <div className="lbl">avg cost / call</div>
          <div className="val">{fmtUSD(traces.length ? totalSpend / traces.filter(t => priceFor(t)).length : 0)}</div>
        </div>
        <div className="con-stat">
          <div className="lbl">most expensive model</div>
          <div className="val" style={{ fontSize: 16, fontFamily: "'Geist Mono', monospace" }}>
            {byModel.find(m => !m.missing)?.model || "—"}
          </div>
          <div className="delta">{byModel.find(m => !m.missing) ? fmtUSD(byModel.find(m => !m.missing).total) : "—"}</div>
        </div>
      </div>

      <div className="con-tools">
        <FilterChip label="group: provider" active />
        <FilterChip label="group: model" />
        <FilterChip label="group: conversation" />
        <div className="spacer" />
        <div className="window-switch">
          <button className={win === "24h" ? "active" : ""} onClick={() => setWin("24h")}>24h</button>
          <button className={win === "all" ? "active" : ""} onClick={() => setWin("all")}>all-time</button>
        </div>
      </div>

      <div className="cost-grid">
        <div className="cost-pane">
          <div className="ph">
            <h3>spend per hour · last 24h</h3>
            <div className="lgnd">
              <span><span style={{ display: "inline-block", width: 8, height: 8, background: "var(--p-openai)", marginRight: 4 }}></span>openai</span>
              <span><span style={{ display: "inline-block", width: 8, height: 8, background: "var(--p-anthropic)", marginRight: 4 }}></span>anthropic</span>
              <span><span style={{ display: "inline-block", width: 8, height: 8, background: "var(--p-gemini)", marginRight: 4 }}></span>gemini</span>
              <span><span style={{ display: "inline-block", width: 8, height: 8, background: "var(--p-mock)", marginRight: 4 }}></span>mock</span>
            </div>
          </div>
          <div className="cost-chart">
            <div className="cost-bars">
              {buckets.map((b, i) => {
                const t = b.openai + b.anthropic + b.gemini + b.mock;
                const seg = (v) => {
                  if (v <= 0) return { height: "0%", display: "none" };
                  const pct = Math.max(2, (v / maxBucket) * 100);
                  return { height: `${pct}%`, minHeight: 2 };
                };
                return (
                  <div className="cost-bar" key={i} title={`hour -${24 - i}h · ${fmtUSD(t)}`}>
                    <span className="so" style={seg(b.openai)}></span>
                    <span className="sa" style={seg(b.anthropic)}></span>
                    <span className="sg" style={seg(b.gemini)}></span>
                    <span className="sm" style={seg(b.mock)}></span>
                  </div>
                );
              })}
            </div>
            <div className="cost-axis">
              {Array.from({ length: 24 }, (_, i) => <span key={i}>-{24 - i}h</span>)}
            </div>
          </div>
        </div>

        <div className="cost-pane">
          <div className="ph">
            <h3>by model</h3>
            <div className="lgnd">prompt · completion · total</div>
          </div>
          <div style={{ overflow: "auto", flex: 1 }}>
            <table className="brk-table">
              <thead>
                <tr>
                  <th>model</th>
                  <th className="num">calls</th>
                  <th className="num">prompt $</th>
                  <th className="num">completion $</th>
                  <th className="num">total</th>
                </tr>
              </thead>
              <tbody>
                {byModel.map((m) => (
                  <tr key={m.provider + "|" + m.model}>
                    <td>
                      <span className="ptag" data-prov={m.provider}>
                        <span className="swatch"></span>
                        <span>{m.model}</span>
                      </span>
                    </td>
                    <td className="num">{m.calls}</td>
                    <td className="num">{m.missing ? <span title="no pricing entry; contributes zero" className="dim">—</span> : fmtUSD(m.prompt)}</td>
                    <td className="num">{m.missing ? <span className="dim">—</span> : fmtUSD(m.completion)}</td>
                    <td className="num"><b style={{ fontWeight: 600 }}>{m.missing ? <span className="dim">—</span> : fmtUSD(m.total)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: "8px 14px", color: "var(--con-dim-2)", fontFamily: "'Geist Mono', monospace", fontSize: 10.5 }}>
              "—" = no pricing entry; contributes zero to totals.
            </div>

            <div className="ph"><h3>top conversations</h3></div>
            <table className="brk-table">
              <thead>
                <tr>
                  <th>conversation</th>
                  <th className="num">calls</th>
                  <th className="num">spend</th>
                </tr>
              </thead>
              <tbody>
                {byConv.map((c) => (
                  <tr key={c.conv}>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--con-text)" }}>{c.conv}</td>
                    <td className="num">{c.calls}</td>
                    <td className="num"><b>{fmtUSD(c.total)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { ConsoleSurface });
