// chat-context-and-ux-polish LLD Tasks 70/72 — ProvidersController.
//
// Tests the catalog-passthrough contract by directly instantiating the
// controller with a stub `SDK_CATALOG` accessor + a stub health service —
// matches the rest of the api tests, which avoid @nestjs/testing for the same
// reason (keeps the dependency graph tight and the assertion surface explicit).
//
// chat-context-and-ux-polish (Codex review — LLD Task 70 acceptance): the
// endpoint MUST be session-guarded and an unauthenticated caller MUST get
// 401. The previous suite only instantiated the controller directly (which
// bypasses the guard), so it never proved the guard is wired. Below we assert
// the @UseGuards(SessionGuard) metadata AND drive the guard against an
// unauthenticated request to confirm the 401 contract — without pulling in
// @nestjs/testing (kept out of the api test suite by convention).
//
// Availability (bug fix): each entry now carries an `available` flag derived
// from the inference log via ProviderHealthService. The stub below lets each
// test choose which (provider, model) pairs read back unavailable.
import {
  UnauthorizedException,
  UseGuards,
  type ExecutionContext,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ProvidersController } from '../../src/providers/providers.controller';
import {
  ProviderHealthService,
  providerModelKey,
} from '../../src/providers/provider-health.service';
import { SessionGuard } from '../../src/auth/session.guard';
import { SESSION_COOKIE_NAME } from '../../src/common/session-cookie';
import type { AuthenticatedRequest } from '../../src/auth/session.guard';
import type { AuthService } from '../../src/auth/auth.service';
import type { SdkCatalogAccessor } from '../../src/common/sdk-catalog.provider';
import type { ConfiguredProviderEntry } from '@argus/sdk';

// Silence the unused-import lint for the decorator we only reference for its
// type identity in the metadata assertion.
void UseGuards;

interface StubResult {
  controller: ProvidersController;
  callCount: () => number;
}

function makeController(
  entries: ConfiguredProviderEntry[],
  unavailableKeys: string[] = [],
): StubResult {
  let calls = 0;
  const stub: SdkCatalogAccessor = {
    listConfiguredProviders: () => {
      calls += 1;
      return entries;
    },
    getCatalogEntry: () => null,
    getEffectiveBudget: (d) => d,
  };
  const health = {
    unavailableModelKeys: async () => new Set(unavailableKeys),
  } as unknown as ProviderHealthService;
  const controller = new ProvidersController(stub, health);
  return { controller, callCount: () => calls };
}

const REQ = {
  user: { id: 'user-1' },
} as unknown as AuthenticatedRequest;

describe('ProvidersController.list (Tasks 70/71/72/73)', () => {
  it('calls listConfiguredProviders once per request and returns entries marked available', async () => {
    const entries: ConfiguredProviderEntry[] = [
      {
        provider: 'openai',
        model: 'gpt-4o-mini',
        promptPerMillion: 0.15,
        completionPerMillion: 0.6,
        contextWindow: 128_000,
      },
    ];
    const { controller, callCount } = makeController(entries);
    const result = await controller.list(REQ);
    expect(result.providers).toEqual([{ ...entries[0], available: true }]);
    expect(callCount()).toBe(1);
  });

  it('marks a (provider, model) unavailable when the health service flags it', async () => {
    const entries: ConfiguredProviderEntry[] = [
      {
        provider: 'gemini',
        model: 'gemini-3-flash-preview',
        promptPerMillion: 0,
        completionPerMillion: 0,
        contextWindow: 1_000_000,
      },
      {
        provider: 'openai',
        model: 'gpt-4o-mini',
        promptPerMillion: 0.15,
        completionPerMillion: 0.6,
        contextWindow: 128_000,
      },
    ];
    const { controller } = makeController(entries, [
      providerModelKey('gemini', 'gemini-3-flash-preview'),
    ]);
    const result = await controller.list(REQ);
    const gemini = result.providers.find((p) => p.provider === 'gemini')!;
    const openai = result.providers.find((p) => p.provider === 'openai')!;
    expect(gemini.available).toBe(false);
    expect(openai.available).toBe(true);
  });

  it('preserves explicit null cost / null context window fields (picker renders "—")', async () => {
    const entries: ConfiguredProviderEntry[] = [
      {
        provider: 'openai',
        model: 'gpt-unicorn-9000',
        promptPerMillion: null,
        completionPerMillion: null,
        contextWindow: null,
      },
    ];
    const { controller } = makeController(entries);
    const result = await controller.list(REQ);
    expect(result.providers).toHaveLength(1);
    const entry = result.providers[0]!;
    // Explicit null preserved — not omitted, not undefined.
    expect(entry.promptPerMillion).toBeNull();
    expect(entry.completionPerMillion).toBeNull();
    expect(entry.contextWindow).toBeNull();
    // JSON round-trip preserves the nulls explicitly (the picker's wire
    // shape is the canonical assertion).
    const wire = JSON.parse(JSON.stringify(result));
    expect(wire.providers[0].promptPerMillion).toBeNull();
    expect(wire.providers[0].contextWindow).toBeNull();
    expect(wire.providers[0].available).toBe(true);
  });

  it('returns an empty providers array when the catalog is empty', async () => {
    const { controller } = makeController([]);
    const result = await controller.list(REQ);
    expect(result.providers).toEqual([]);
  });
});

// chat-context-and-ux-polish (Codex review — LLD Task 70 acceptance).
describe('ProvidersController — SessionGuard 401 (Task 70)', () => {
  function buildCtx(
    req: { cookies?: Record<string, string>; user?: { id: string } },
  ): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({}),
        getNext: () => ({}),
      }),
    } as unknown as ExecutionContext;
  }

  it('is decorated with @UseGuards(SessionGuard)', () => {
    // Class-level guard metadata — proves the guard is actually wired (a
    // direct controller.list() call bypasses it, so this is the only way to
    // assert the wiring without a full HTTP harness).
    const guards = Reflect.getMetadata(GUARDS_METADATA, ProvidersController) as unknown[];
    expect(guards).toBeDefined();
    expect(guards).toContain(SessionGuard);
  });

  it('the guard rejects an unauthenticated request with 401 (no session cookie)', async () => {
    const auth = { findUserBySessionToken: async () => null } as unknown as AuthService;
    const guard = new SessionGuard(auth);
    await expect(guard.canActivate(buildCtx({ cookies: {} }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('the guard rejects a request whose cookie maps to no session with 401', async () => {
    const auth = { findUserBySessionToken: async () => null } as unknown as AuthService;
    const guard = new SessionGuard(auth);
    await expect(
      guard.canActivate(buildCtx({ cookies: { [SESSION_COOKIE_NAME]: 'stale' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('the guard admits an authenticated request and the controller then lists', async () => {
    const auth = { findUserBySessionToken: async () => 'user-1' } as unknown as AuthService;
    const guard = new SessionGuard(auth);
    const req = { cookies: { [SESSION_COOKIE_NAME]: 'good' } };
    await expect(guard.canActivate(buildCtx(req))).resolves.toBe(true);
    // Once past the guard, the controller serves the catalog.
    const { controller } = makeController([]);
    expect((await controller.list(REQ)).providers).toEqual([]);
  });
});
