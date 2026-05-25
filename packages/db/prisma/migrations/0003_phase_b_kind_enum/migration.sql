-- Phase B — control-plane schema extensions (LLD backend-infra, CONTRACTS §DB migration).
--
-- Adds:
--   * inference_kind enum (chat|classifier|replay|sample|heartbeat|unknown)
--   * inferences.kind (NOT NULL DEFAULT 'chat' — Phase A rows backfill as chat;
--     `unknown` is reserved for unrecognized OTel values only)
--   * inferences FKs: classifier_for_message_id → messages, replay_of_inference_id
--     (self-FK), sample_workspace_id → sample_workspaces (all nullable, ON DELETE SET NULL)
--   * inferences.updated_at (@updatedAt, Prisma-client-managed; DEFAULT CURRENT_TIMESTAMP
--     backfills existing rows — NOT a DB trigger)
--   * sample_workspaces, user_clear_fences tables
--   * sessions.current_sample_workspace_id → sample_workspaces (ON DELETE SET NULL)
--   * trace_events.kind + (kind, created_at DESC) index
--   * trace_events unique widened from (trace_id, span_id) to (trace_id, span_id, name):
--     a span persists multiple named events on first delivery; redeliveries still
--     collide on their first event (P2002 = idempotency skip).
--   * supporting indexes on inferences (kind + the three FK columns)

-- CreateEnum
CREATE TYPE "inference_kind" AS ENUM ('chat', 'classifier', 'replay', 'sample', 'heartbeat', 'unknown');

-- DropIndex
DROP INDEX "trace_events_trace_id_span_id_key";

-- AlterTable
ALTER TABLE "inferences" ADD COLUMN     "classifier_for_message_id" UUID,
ADD COLUMN     "kind" "inference_kind" NOT NULL DEFAULT 'chat',
ADD COLUMN     "replay_of_inference_id" UUID,
ADD COLUMN     "sample_workspace_id" UUID,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "current_sample_workspace_id" UUID;

-- AlterTable
ALTER TABLE "trace_events" ADD COLUMN     "kind" "inference_kind";

-- CreateTable
CREATE TABLE "sample_workspaces" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sample_workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_clear_fences" (
    "user_id" UUID NOT NULL,
    "clear_after_ts" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_clear_fences_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE INDEX "sample_workspaces_user_id_idx" ON "sample_workspaces"("user_id");

-- CreateIndex
CREATE INDEX "inferences_kind_idx" ON "inferences"("kind");

-- CreateIndex
CREATE INDEX "inferences_classifier_for_message_id_idx" ON "inferences"("classifier_for_message_id");

-- CreateIndex
CREATE INDEX "inferences_replay_of_inference_id_idx" ON "inferences"("replay_of_inference_id");

-- CreateIndex
CREATE INDEX "inferences_sample_workspace_id_idx" ON "inferences"("sample_workspace_id");

-- CreateIndex
CREATE INDEX "trace_events_kind_created_at_idx" ON "trace_events"("kind", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "trace_events_trace_id_span_id_name_key" ON "trace_events"("trace_id", "span_id", "name");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_current_sample_workspace_id_fkey" FOREIGN KEY ("current_sample_workspace_id") REFERENCES "sample_workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inferences" ADD CONSTRAINT "inferences_classifier_for_message_id_fkey" FOREIGN KEY ("classifier_for_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inferences" ADD CONSTRAINT "inferences_replay_of_inference_id_fkey" FOREIGN KEY ("replay_of_inference_id") REFERENCES "inferences"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inferences" ADD CONSTRAINT "inferences_sample_workspace_id_fkey" FOREIGN KEY ("sample_workspace_id") REFERENCES "sample_workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_workspaces" ADD CONSTRAINT "sample_workspaces_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_clear_fences" ADD CONSTRAINT "user_clear_fences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
