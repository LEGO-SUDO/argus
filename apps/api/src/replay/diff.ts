// diff — word-level change list between two strings (the source output vs the
// replay output), capped at the configured output-size budget. Over the cap,
// returns a `{ tooLarge: true }` sentinel instead of computing a diff that
// would be too big to render meaningfully.
import { diffWords } from 'diff';
import type { DiffResult, DiffChange } from '@argus/contracts';

export function computeDiff(before: string, after: string, capBytes: number): DiffResult {
  if (Buffer.byteLength(before, 'utf8') > capBytes || Buffer.byteLength(after, 'utf8') > capBytes) {
    return { tooLarge: true };
  }
  const changes: DiffChange[] = diffWords(before, after).map((part) => ({
    value: part.value,
    ...(part.added ? { added: true } : {}),
    ...(part.removed ? { removed: true } : {}),
  }));
  return { changes };
}
