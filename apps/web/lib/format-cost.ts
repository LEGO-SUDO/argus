// format-cost — shared micro-USD display formatting for the Cost tab.
//
// LLD frontend-web Phase 8. Micro-USD (millionths of a dollar) are the wire
// unit; display rounds ONCE at the end via toFixed(2). Sub-cent-but-positive
// totals render as "< $0.01" (so a real cost never reads as "$0.00"); a true
// zero renders "$0.00". CostHeader and CostTable both use this so the rounding
// rule is identical everywhere (Tasks 128-131, 136-137).

const MICROS_PER_USD = 1_000_000;

export function formatMicroUsd(micros: number): string {
  if (micros <= 0) {
    return '$0.00';
  }
  const dollars = micros / MICROS_PER_USD;
  if (dollars < 0.01) {
    return '< $0.01';
  }
  return `$${dollars.toFixed(2)}`;
}
