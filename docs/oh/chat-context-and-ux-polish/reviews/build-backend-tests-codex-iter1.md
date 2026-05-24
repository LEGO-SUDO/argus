1. **Test gaps the LLD's acceptance demands but weren't covered**

“metadata frame emits EXACTLY ONCE per turn, on the SDK `commit` chunk” should be tested at gateway/full WS level, not only `StreamOrchestrator`; add to `apps/api/test/chat/chat.gateway.test.ts`.

“`start@0 → metadata@1 → token@2..N → terminal`” full lifecycle with request pin/budget/guess propagation should be tested end-to-end in `apps/api/test/chat/chat.gateway.test.ts`.

“GET /providers … Session-guarded; unauthenticated callers receive 401” is explicitly skipped; should be in `apps/api/test/providers/providers.controller.test.ts` or an HTTP/Nest integration test.

“PATCH validates non-null pins against the live SDK catalog before persisting” lacks malformed-body controller assertions; add to `apps/api/test/conversations/conversations.controller.test.ts`.

“pinFallback … conversation DTO carries both pin fields as null” is not actually asserted because `MessageListResponse` has no conversation DTO and controller does `void conversationForDto`; either acceptance/design is stale or the test is missing an observable DTO assertion.

2. **Negative-case gaps**

Missing mid-stream provider throw after commit at orchestrator/gateway level: should assert `start → metadata → token → error → end(failed)`, partial persistence, no meter fields.

PATCH malformed pin payloads are mostly contract-only. Controller should assert asymmetric fields, empty strings, wrong types, and empty/null mix return `400 invalid_request`, not `invalid_pin`.

Meter service throwing is covered in controller/orchestrator, but not gateway full path after successful stream.

Concurrent commit chunks are only sequential duplicate commits. No race/concurrent stream test ensuring per-message seq registries do not bleed across simultaneous turns.

Pin column DB constraint hit is not applicable as implemented: migration deliberately has no CHECK constraint. If acceptance expected DB coupling, this is a product gap, not just a test gap.

Orchestrator abort mid-stream is partially cancel/disconnect covered, but not abort from SDK/request signal producing a thrown abort error after commit/token.

3. **Wire-invariant assertions missing**

Seq monotonic across a full gateway-emitted stream is weak. Orchestrator tests assert it, but gateway tests mostly assert types/request shape.

Metadata never emitted twice in the same turn is covered in orchestrator, not gateway.

Token fields absent on `status=failed`/`canceled` end are covered in orchestrator meter tests, not contract schema. The schema still allows token fields on failed/canceled ends, so only runtime coverage exists.

Metadata absent on pre-token failure is covered in orchestrator and gateway pinned-provider failure.

4. **Integration-level gaps**

No real Nest module boot test for the new `forwardRef` cycle across `ChatModule`, `ConversationsModule`, and `ProvidersModule`.

No HTTP-level `PATCH /conversations/:id` test proving Zod pipe/body handling, auth guard, live catalog injection, repository update, and DTO response together.

No WS-level lifecycle test from inbound `send` through `ChatGateway → ChatService → SDK stream → StreamOrchestrator → persisted assistant row`, asserting `start → metadata → token → token → end` plus request attrs and final DB state.

No integration test that `GET /providers` uses the real SDK catalog/env gating through the Nest provider.

5. **OTel test gaps**

Effective budget: asserted.

Catalog cap: asserted.

Guess-vs-commit divergence: asserted only on success, not omitted/no-guess and not failure.

Pinned failure boolean: asserted for pin and non-pin failures.

Truncation event: not asserted here.

Pin-fallback event: not asserted here.

If HLD §Observability requires five attrs/events including truncation and pin fallback, the suite only covers four-ish SDK span attrs and misses the two event-style acceptance points.

6. **Edge cases the worker didn’t think of**

`ConversationsController.update` test “provider is not configured” seeds a different Prisma than the controller uses, so it may pass for the wrong reason as 404 instead of `invalid_pin`.

Pinned provider set but pinned model null in legacy/corrupt DB: gateway silently omits pin; no test documents that tolerance.

`contextWindowCap` is omitted for unknown pin while `effectiveBudget` defaults; no test asserts this mixed hint behavior.

`PROVIDER_ORDER` parsing for guess provider with invalid names, mock first, or configured provider not in order is untested.

`ContextMeterService` counts all statuses, including streaming/failed/canceled; no test confirms whether that is intended versus only completed persisted content.

7. **Test sufficiency score 1-10**

7/10. Strong unit coverage, but too many invariants stop below the actual wire/module boundary, and observability/fallback acceptance is only partially pinned.
