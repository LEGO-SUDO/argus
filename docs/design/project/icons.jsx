// icons.jsx — small stroke icons used across both surfaces.
// Pure SVG, inherits color via stroke=currentColor.

const Icon = ({ name, size = 14, className = "" }) => {
  const s = size;
  const common = {
    width: s, height: s, viewBox: "0 0 24 24",
    fill: "none", stroke: "currentColor", strokeWidth: 1.6,
    strokeLinecap: "round", strokeLinejoin: "round",
    className,
  };
  const P = (paths) => React.createElement("svg", common, ...paths);
  const P_ = (k, props) => React.createElement(k, props);

  switch (name) {
    case "plus":
      return P([P_("path", { key: 1, d: "M12 5v14M5 12h14" })]);
    case "arrow-up":
      return P([P_("path", { key: 1, d: "M12 19V5M5 12l7-7 7 7" })]);
    case "arrow-right":
      return P([P_("path", { key: 1, d: "M5 12h14M13 5l7 7-7 7" })]);
    case "arrow-down-right":
      return P([P_("path", { key: 1, d: "M7 7l10 10M17 9v8h-8" })]);
    case "stop":
      return P([P_("rect", { key: 1, x: 7, y: 7, width: 10, height: 10, rx: 1.5 })]);
    case "search":
      return P([
        P_("circle", { key: 1, cx: 11, cy: 11, r: 7 }),
        P_("path",   { key: 2, d: "M20 20l-3.5-3.5" }),
      ]);
    case "filter":
      return P([P_("path", { key: 1, d: "M4 5h16l-6 8v6l-4-2v-4z" })]);
    case "copy":
      return P([
        P_("rect", { key: 1, x: 9, y: 9, width: 11, height: 11, rx: 2 }),
        P_("path", { key: 2, d: "M5 15V6a2 2 0 0 1 2-2h9" }),
      ]);
    case "logout":
      return P([
        P_("path", { key: 1, d: "M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" }),
        P_("path", { key: 2, d: "M16 17l5-5-5-5M21 12H10" }),
      ]);
    case "settings":
      return P([
        P_("circle", { key: 1, cx: 12, cy: 12, r: 2.5 }),
        P_("path",   { key: 2, d: "M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.5-2.4.8a7 7 0 0 0-2.1-1.2L14 3h-4l-.4 2.3A7 7 0 0 0 7.5 6.5L5.1 5.7l-2 3.5 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.5 2.4-.8A7 7 0 0 0 9.6 18.7L10 21h4l.4-2.3a7 7 0 0 0 2.1-1.2l2.4.8 2-3.5-2-1.6c.05-.4.1-.8.1-1.2z" }),
      ]);
    case "edit":
      return P([
        P_("path", { key: 1, d: "M3 17.5V21h3.5L18 9.5 14.5 6 3 17.5z" }),
        P_("path", { key: 2, d: "M14.5 6L18 9.5" }),
      ]);
    case "trash":
      return P([
        P_("path", { key: 1, d: "M4 7h16M9 7V4h6v3" }),
        P_("path", { key: 2, d: "M6 7l1 13h10l1-13" }),
      ]);
    case "chat":
      return P([P_("path", { key: 1, d: "M21 12a8 8 0 0 1-12 6.9L4 20l1.1-4.6A8 8 0 1 1 21 12z" })]);
    case "console":
      return P([
        P_("rect", { key: 1, x: 3, y: 4, width: 18, height: 16, rx: 2 }),
        P_("path", { key: 2, d: "M7 9l3 3-3 3M13 15h4" }),
      ]);
    case "replay":
      return P([
        P_("path",   { key: 1, d: "M4 4v6h6" }),
        P_("path",   { key: 2, d: "M4 10a8 8 0 1 0 2.5-5.8L4 7" }),
      ]);
    case "list":
      return P([
        P_("path", { key: 1, d: "M4 6h16M4 12h16M4 18h16" }),
      ]);
    case "dollar":
      return P([P_("path", { key: 1, d: "M12 3v18M16 7H10a2.5 2.5 0 0 0 0 5h4a2.5 2.5 0 0 1 0 5H8" })]);
    case "check":
      return P([P_("path", { key: 1, d: "M4 12l5 5L20 6" })]);
    case "x":
      return P([P_("path", { key: 1, d: "M6 6l12 12M18 6L6 18" })]);
    case "external":
      return P([
        P_("path", { key: 1, d: "M14 4h6v6" }),
        P_("path", { key: 2, d: "M20 4l-9 9M19 14v6H4V5h6" }),
      ]);
    case "info":
      return P([
        P_("circle", { key: 1, cx: 12, cy: 12, r: 9 }),
        P_("path",   { key: 2, d: "M12 8h.01M11 12h1v5h1" }),
      ]);
    case "warn":
      return P([
        P_("path", { key: 1, d: "M12 4l10 17H2L12 4z" }),
        P_("path", { key: 2, d: "M12 10v4M12 18h.01" }),
      ]);
    case "bolt":
      return P([P_("path", { key: 1, d: "M13 3L4 14h7l-1 7 9-11h-7l1-7z" })]);
    case "sparkles":
      return P([
        P_("path", { key: 1, d: "M12 4l1.5 4.5L18 10l-4.5 1.5L12 16l-1.5-4.5L6 10l4.5-1.5z" }),
        P_("path", { key: 2, d: "M19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z" }),
      ]);
    case "menu":
      return P([P_("circle", { key: 1, cx: 12, cy: 6, r: 1.2 }),
                P_("circle", { key: 2, cx: 12, cy: 12, r: 1.2 }),
                P_("circle", { key: 3, cx: 12, cy: 18, r: 1.2 })]);
    case "cmd-k":
      return P([P_("path", { key: 1, d: "M8 4v16M16 4v16M4 8h16M4 16h16" })]);
    default:
      return P([P_("circle", { key: 1, cx: 12, cy: 12, r: 8 })]);
  }
};

// Brand mark used in the wordmark
function BrandMark({ size = 18 }) {
  return (
    <span className="brand">
      <span className="mark" style={{ width: size, height: size }}></span>
      <span className="name">argus</span>
    </span>
  );
}

// Sparkline svg
function Sparkline({ data, color = "currentColor", width = 80, height = 22, fill = false }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  const pts = data.map((v, i) => [i * step, height - ((v - min) / range) * (height - 2) - 1]);
  const path = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${path} L${width} ${height} L0 ${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      {fill && <path d={area} fill={color} opacity="0.12" />}
      <path d={path} stroke={color} strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

Object.assign(window, { Icon, BrandMark, Sparkline });
