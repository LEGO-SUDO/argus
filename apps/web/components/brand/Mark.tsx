/**
 * Mark — the geometric argus brand mark.
 *
 * A 16×16 rounded square in the surface ink color with a 4×4 terra-accent
 * dot in the top-right corner. Translates the `.brand .mark` rules from
 * `docs/design/project/styles.css` (lines 84–97) into a React component.
 *
 * Pure presentational. Uses the `--chat-ink` token for the body so a
 * `.surface-console` wrapper (Phase B) automatically flips it to
 * `--con-text` via `globals.css`. The dot is the shared `--acc` accent.
 */
type MarkProps = {
  className?: string;
};

export function Mark({ className }: MarkProps) {
  return (
    <span
      aria-hidden="true"
      data-testid="brand-mark"
      className={
        "relative inline-block h-4 w-4 rounded-[4px] bg-chat-ink" +
        " after:absolute after:right-1 after:top-1 after:h-1 after:w-1" +
        " after:rounded-[1px] after:bg-acc after:content-['']" +
        (className ? ` ${className}` : "")
      }
    />
  );
}
