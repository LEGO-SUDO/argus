// Phase A placeholder: no `pricing` table exists yet. Phase B replaces this
// with a real seeder that hot-loads provider/model price points.
//
// Kept as a callable no-op so the API bootstrap can call `seedPricing()`
// unconditionally and Phase B just swaps the implementation.
export async function seedPricing(): Promise<void> {
  // intentional no-op for Phase A — pricing snapshot lives in packages/sdk.
  return Promise.resolve();
}
