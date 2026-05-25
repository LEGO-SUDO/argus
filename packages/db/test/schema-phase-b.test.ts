// Phase B migration (0003_phase_b_kind_enum) schema-shape integration tests.
//
// Boots one ephemeral Postgres for the whole file, applies the committed
// migrations via `prisma migrate deploy`, then asserts the resulting catalog
// shape and FK delete semantics. Each `it` names one behavioral guarantee.
//
// Skips cleanly when Docker is unavailable (loud SKIP).
import { randomUUID } from 'node:crypto';
import {
  bootTestDb,
  teardownTestDb,
  dockerAvailable,
  type TestDb,
} from './helpers/prisma-testcontainer';

const describeIntegration = dockerAvailable() ? describe : describe.skip;

if (!dockerAvailable()) {
  // eslint-disable-next-line no-console
  console.warn('[schema-phase-b] SKIPPED: docker unavailable. CI must run this suite.');
}

interface ColumnRow {
  column_name: string;
  is_nullable: 'YES' | 'NO';
  udt_name: string;
  column_default: string | null;
}

interface FkRow {
  conname: string;
  column_name: string;
  referenced_table: string;
  confdeltype: string; // a=no action, c=cascade, n=set null, r=restrict, d=set default
}

describeIntegration('Phase B schema (migration 0003)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await bootTestDb();
  }, 120_000);

  afterAll(async () => {
    if (db) await teardownTestDb(db);
  }, 30_000);

  async function columns(table: string): Promise<ColumnRow[]> {
    return db.prisma.$queryRawUnsafe<ColumnRow[]>(
      `SELECT column_name, is_nullable, udt_name, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1`,
      table,
    );
  }

  async function indexNames(table: string): Promise<string[]> {
    const rows = await db.prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1`,
      table,
    );
    return rows.map((r) => r.indexname);
  }

  async function foreignKeys(table: string): Promise<FkRow[]> {
    return db.prisma.$queryRawUnsafe<FkRow[]>(
      `SELECT con.conname,
              att.attname            AS column_name,
              con.confrelid::regclass::text AS referenced_table,
              con.confdeltype
         FROM pg_constraint con
         JOIN pg_attribute att
           ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
        WHERE con.conrelid = ($1)::regclass AND con.contype = 'f'`,
      table,
    );
  }

  async function seedUser(): Promise<string> {
    const id = randomUUID();
    await db.prisma.user.create({
      data: { id, email: `u-${id}@test.local`, passwordHash: 'x' },
    });
    return id;
  }

  // --- Task 4: kind enum column ---
  it('inferences carries the kind enum column with default chat, backed by a Postgres enum type named inference_kind', async () => {
    const kind = (await columns('inferences')).find((c) => c.column_name === 'kind');
    expect(kind).toBeDefined();
    expect(kind?.udt_name).toBe('inference_kind');
    expect(kind?.is_nullable).toBe('NO');
    expect(kind?.column_default).toContain('chat');
  });

  // --- Task 6: index on inferences(kind) ---
  it('inferences carries a btree index on the kind column', async () => {
    expect(await indexNames('inferences')).toContain('inferences_kind_idx');
  });

  // --- Task 8: sample_workspaces table ---
  it('sample_workspaces table exists with id, user_id, created_at', async () => {
    const cols = await columns('sample_workspaces');
    const byName = new Map(cols.map((c) => [c.column_name, c]));
    expect(byName.get('id')?.udt_name).toBe('uuid');
    expect(byName.get('user_id')?.udt_name).toBe('uuid');
    expect(byName.get('created_at')?.udt_name).toMatch(/timestamp/);
    expect(byName.get('created_at')?.column_default).toContain('CURRENT_TIMESTAMP');
  });

  // --- Task 10: user_clear_fences table ---
  it('user_clear_fences table exists keyed on user_id', async () => {
    const cols = await columns('user_clear_fences');
    const byName = new Map(cols.map((c) => [c.column_name, c]));
    expect(byName.get('user_id')?.udt_name).toBe('uuid');
    expect(byName.get('clear_after_ts')?.is_nullable).toBe('NO');
    expect(byName.get('updated_at')?.udt_name).toMatch(/timestamp/);
    // PK on user_id.
    const pk = await db.prisma.$queryRawUnsafe<{ attname: string }[]>(
      `SELECT a.attname
         FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
        WHERE i.indrelid = 'user_clear_fences'::regclass AND i.indisprimary`,
    );
    expect(pk.map((r) => r.attname)).toEqual(['user_id']);
  });

  // --- Task 14: three nullable FK columns on inferences ---
  it('inferences carries classifier/replay/sample-workspace FKs all nullable', async () => {
    const cols = await columns('inferences');
    const byName = new Map(cols.map((c) => [c.column_name, c]));
    for (const col of [
      'classifier_for_message_id',
      'replay_of_inference_id',
      'sample_workspace_id',
    ]) {
      expect(byName.get(col)?.udt_name).toBe('uuid');
      expect(byName.get(col)?.is_nullable).toBe('YES');
    }

    const fks = await foreignKeys('inferences');
    const byCol = new Map(fks.map((f) => [f.column_name, f]));
    expect(byCol.get('classifier_for_message_id')?.referenced_table).toBe('messages');
    expect(byCol.get('replay_of_inference_id')?.referenced_table).toBe('inferences');
    expect(byCol.get('sample_workspace_id')?.referenced_table).toBe('sample_workspaces');
  });

  // --- Reviewer concern: indexes on the three FK columns exist ---
  it('inferences carries btree indexes on the three Phase B FK columns', async () => {
    const idx = await indexNames('inferences');
    expect(idx).toEqual(
      expect.arrayContaining([
        'inferences_classifier_for_message_id_idx',
        'inferences_replay_of_inference_id_idx',
        'inferences_sample_workspace_id_idx',
      ]),
    );
  });

  // --- Task 18: inferences.updated_at exists and ticks on Prisma update ---
  it('inferences.updated_at exists and ticks on Prisma-mediated update', async () => {
    const ua = (await columns('inferences')).find((c) => c.column_name === 'updated_at');
    expect(ua).toBeDefined();
    expect(ua?.udt_name).toMatch(/timestamp/);

    const userId = await seedUser();
    const created = await db.prisma.inference.create({
      data: {
        messageId: randomUUID(),
        conversationId: randomUUID(),
        userId,
        provider: 'openai',
        model: 'gpt-4o-mini',
        status: 'streaming',
        startedAt: new Date(),
      },
    });
    await new Promise((r) => setTimeout(r, 50));
    const updated = await db.prisma.inference.update({
      where: { id: created.id },
      data: { outputPreview: 'tick' },
    });
    expect(updated.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());
  });

  // --- Task 12 (cascade half): deleting a user cascades sample_workspaces ---
  it('FK delete semantics: deleting a user cascades its sample_workspaces rows away', async () => {
    const userId = await seedUser();
    const ws = await db.prisma.sampleWorkspace.create({ data: { userId } });
    await db.prisma.user.delete({ where: { id: userId } });
    const found = await db.prisma.sampleWorkspace.findUnique({ where: { id: ws.id } });
    expect(found).toBeNull();
  });

  // --- Task 16 / Task 12 (SET NULL half): sessions.current_sample_workspace_id ---
  it('sessions carries a nullable current sample workspace pointer with SET NULL on delete', async () => {
    const cols = await columns('sessions');
    const pointer = cols.find((c) => c.column_name === 'current_sample_workspace_id');
    expect(pointer?.udt_name).toBe('uuid');
    expect(pointer?.is_nullable).toBe('YES');

    const fk = (await foreignKeys('sessions')).find(
      (f) => f.column_name === 'current_sample_workspace_id',
    );
    expect(fk?.referenced_table).toBe('sample_workspaces');
    expect(fk?.confdeltype).toBe('n'); // 'n' = ON DELETE SET NULL

    // Behavioral: deleting the workspace nulls the pointer, keeps the session.
    const userId = await seedUser();
    const ws = await db.prisma.sampleWorkspace.create({ data: { userId } });
    const session = await db.prisma.session.create({
      data: {
        userId,
        tokenHash: `tok-${randomUUID()}`,
        expiresAt: new Date(Date.now() + 3_600_000),
        currentSampleWorkspaceId: ws.id,
      },
    });
    await db.prisma.sampleWorkspace.delete({ where: { id: ws.id } });
    const after = await db.prisma.session.findUnique({ where: { id: session.id } });
    expect(after).not.toBeNull();
    expect(after?.currentSampleWorkspaceId).toBeNull();
  });

  // --- CONTRACTS §DB migration: trace_events.kind + (kind, created_at DESC) index ---
  it('trace_events carries a nullable kind enum column and a (kind, created_at DESC) index', async () => {
    const kind = (await columns('trace_events')).find((c) => c.column_name === 'kind');
    expect(kind?.udt_name).toBe('inference_kind');
    expect(kind?.is_nullable).toBe('YES');
    expect(await indexNames('trace_events')).toContain('trace_events_kind_created_at_idx');
  });

  // --- CONTRACTS §DB migration: trace_events unique widened to 3 columns ---
  it('trace_events unique is (trace_id, span_id, name), not the old 2-column key', async () => {
    const idx = await indexNames('trace_events');
    expect(idx).toContain('trace_events_trace_id_span_id_name_key');
    expect(idx).not.toContain('trace_events_trace_id_span_id_key');
  });
});
