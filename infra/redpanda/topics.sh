#!/usr/bin/env bash
# ============================================================================
# Redpanda topic bootstrap.
#
# Idempotent: re-running `up` on an existing cluster does not error.
#
#   - `traces`      OTLP-encoded spans; partition key = message_id (HLD D1),
#                   set producer-side in the OTel Collector exporter config.
#   - `live-events` Phase B post-commit live tick (HLD D3); partition key =
#                   user_id, set producer-side by the workers LiveEventsPublisher.
#                   The api consumer group `api-live-fanout` fans it out over SSE.
#
# This script only ensures the topics exist (shape), never partition keys.
#
# Phase A: traces = 6 partitions / 1 replica (single-node dev cluster).
# Phase B: live-events = 3 partitions / 1 replica (matches dev sizing; per-user
# sticky key keeps ordering when scaling to a multi-replica consumer later).
# For prod, bump --replicas to 3 (and run a 3-broker Redpanda cluster).
# ============================================================================
set -euo pipefail

BROKER="${REDPANDA_BROKER:-redpanda:9092}"

TRACES_TOPIC="${REDPANDA_TRACES_TOPIC:-traces}"
TRACES_PARTITIONS="${REDPANDA_TRACES_PARTITIONS:-6}"
TRACES_REPLICAS="${REDPANDA_TRACES_REPLICAS:-1}"

LIVE_EVENTS_TOPIC="${REDPANDA_LIVE_EVENTS_TOPIC:-live-events}"
LIVE_EVENTS_PARTITIONS="${REDPANDA_LIVE_EVENTS_PARTITIONS:-3}"
LIVE_EVENTS_REPLICAS="${REDPANDA_LIVE_EVENTS_REPLICAS:-1}"

# ensure_topic <name> <partitions> <replicas>
# Creates the topic, tolerating "already exists" so re-runs are idempotent.
ensure_topic() {
  local topic="$1" partitions="$2" replicas="$3"
  local log
  log="$(mktemp)"

  echo "[redpanda-bootstrap] ensuring topic ${topic} (partitions=${partitions}, replicas=${replicas}) on ${BROKER}"

  # `rpk topic create` returns non-zero if the topic exists; we tolerate that.
  if rpk topic create "${topic}" \
      --brokers "${BROKER}" \
      --partitions "${partitions}" \
      --replicas "${replicas}" 2>&1 | tee "${log}"; then
    echo "[redpanda-bootstrap] topic ${topic} created"
  elif grep -q -i "already exists\|TOPIC_ALREADY_EXISTS" "${log}"; then
    echo "[redpanda-bootstrap] topic ${topic} already exists — skipping"
  else
    echo "[redpanda-bootstrap] FAILED to create topic ${topic}"
    cat "${log}"
    rm -f "${log}"
    exit 1
  fi
  rm -f "${log}"
}

ensure_topic "${TRACES_TOPIC}" "${TRACES_PARTITIONS}" "${TRACES_REPLICAS}"
ensure_topic "${LIVE_EVENTS_TOPIC}" "${LIVE_EVENTS_PARTITIONS}" "${LIVE_EVENTS_REPLICAS}"

rpk topic list --brokers "${BROKER}"
echo "[redpanda-bootstrap] done"
