import type { Config } from "tailwindcss";

/**
 * Tailwind theme is the surface of the design system locked in
 * `docs/design/project/styles.css`. All colors resolve through CSS custom
 * properties defined in `app/globals.css` so the chat (light) and console
 * (dark, Phase B) surfaces can share class names and be flipped by changing
 * a single set of variables on a wrapper element.
 *
 * Token naming convention mirrors the design source:
 *   - `acc*`         shared brand accent (terra)
 *   - `chat-*`       warm-light chat surface (Phase A)
 *   - `con-*`        dev-dense console surface (Phase B, preserved but unused)
 *   - status: ok / warn / err / info
 *   - provider: p-openai / p-anthropic / p-gemini / p-mock
 */
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand accent — shared across surfaces.
        acc: "var(--acc)",
        "acc-soft": "var(--acc-soft)",
        "acc-strong": "var(--acc-strong)",

        // Chat (warm light) — Phase A.
        "chat-bg": "var(--chat-bg)",
        "chat-panel": "var(--chat-panel)",
        "chat-ink": "var(--chat-ink)",
        "chat-ink-2": "var(--chat-ink-2)",
        "chat-ink-3": "var(--chat-ink-3)",
        "chat-rule": "var(--chat-rule)",
        "chat-rule-2": "var(--chat-rule-2)",
        "chat-hover": "var(--chat-hover)",

        // Console (dev-dense dark) — Phase B (tokens reserved, no UI yet).
        "con-bg": "var(--con-bg)",
        "con-panel": "var(--con-panel)",
        "con-panel-2": "var(--con-panel-2)",
        "con-rule": "var(--con-rule)",
        "con-rule-2": "var(--con-rule-2)",
        "con-text": "var(--con-text)",
        "con-dim": "var(--con-dim)",
        "con-dim-2": "var(--con-dim-2)",
        "con-hover": "var(--con-hover)",

        // Status — work on both surfaces.
        ok: "var(--ok)",
        warn: "var(--warn)",
        err: "var(--err)",
        info: "var(--info)",

        // Provider colors — consistent across Traces / Cost / Replay.
        "p-openai": "var(--p-openai)",
        "p-anthropic": "var(--p-anthropic)",
        "p-gemini": "var(--p-gemini)",
        "p-mock": "var(--p-mock)",
      },
      borderRadius: {
        sm: "var(--r-sm)",
        md: "var(--r-md)",
        lg: "var(--r-lg)",
      },
      fontFamily: {
        // Wired in `app/layout.tsx` via next/font CSS variables.
        sans: ["var(--font-geist)", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: [
          "var(--font-instrument-serif)",
          "Iowan Old Style",
          "Georgia",
          "serif",
        ],
        mono: [
          "var(--font-geist-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
