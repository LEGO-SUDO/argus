-- chat-context-and-ux-polish backbone — Conversation pin columns.
--
-- HLD D2 reference: per-conversation provider pin (override branch on the
-- SDK router; gateway threads the pin onto each ChatStreamRequest).
--
-- Both columns are nullable text with no default. The application enforces
-- the coupling rule (both-set or both-null) via the
-- UpdateConversationRequestSchema in @argus/contracts; we deliberately do
-- NOT enforce coupling at the DB level because (a) Prisma does not have a
-- first-class CHECK constraint surface and (b) a DB-level enforcement
-- would block legitimate forward-only schema patches if a future model
-- gains a third coupled column.
--
-- Rollback strategy: Argus runs forward-only Prisma migrations
-- (`prisma migrate deploy`). To revert, ship a new forward migration that
-- DROPs both columns — no down migration exists in this directory.
--
-- No data backfill required (NULL is the correct default for existing rows).

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN "pinned_provider" TEXT;
ALTER TABLE "conversations" ADD COLUMN "pinned_model" TEXT;
