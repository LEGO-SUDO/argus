import { Mark } from "./Mark";

/**
 * Wordmark — `<Mark />` + the lowercase wordmark `argus`.
 *
 * Composition mirrors `docs/design/project/icons.jsx` `BrandMark` and the
 * `.brand` / `.brand .name` rules in `docs/design/project/styles.css`
 * (lines 76–104). The `-chat` portion is wrapped in `<b>` so it can read
 * a half-step heavier per the design (`.brand .name b { font-weight: 600 }`).
 *
 * Brand swap: design source uses `argus`; this project is `argus`.
 * Pure presentational — no state, no event handlers.
 */
type WordmarkProps = {
  className?: string;
};

export function Wordmark({ className }: WordmarkProps) {
  return (
    <span
      data-testid="brand-wordmark"
      className={
        "inline-flex items-center gap-2 whitespace-nowrap text-sm font-medium" +
        " text-chat-ink tracking-[-0.01em]" +
        (className ? ` ${className}` : "")
      }
    >
      <Mark />
      <span className="whitespace-nowrap font-medium tracking-[-0.012em]">
        argus<b className="font-semibold">-chat</b>
      </span>
    </span>
  );
}
