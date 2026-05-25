// Sparkline — minimal inline SVG trend line (LLD Tasks 124-127).
//
// Pure render of a number array. No external dependency. An empty array renders
// an SVG with no path; flat data (all values equal) renders a horizontal line
// without dividing by zero.

'use client';

export type SparklineProps = {
  values: number[];
  width?: number;
  height?: number;
  ariaLabel?: string;
};

export function Sparkline({
  values,
  width = 120,
  height = 32,
  ariaLabel = 'Cost trend',
}: SparklineProps) {
  if (values.length === 0) {
    return (
      <svg
        data-testid="console-sparkline"
        width={width}
        height={height}
        role="img"
        aria-label="No trend data"
      />
    );
  }

  const max = Math.max(...values);
  const min = Math.min(...values);
  // Guard against divide-by-zero when every value is equal (flat series).
  const range = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;

  const d = values
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / range) * height;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg
      data-testid="console-sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
    >
      <path
        data-testid="console-sparkline-path"
        d={d}
        fill="none"
        stroke="var(--acc)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
