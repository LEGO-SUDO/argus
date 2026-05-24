#!/usr/bin/env bash
# ============================================================================
# Redpanda topic bootstrap.
#
# Idempotent: re-running `up` on an existing cluster does not error. The
# `traces` topic carries OTLP-encoded spans; partition key is `message_id`
# (HLD D1) and is set producer-side in the OTel Collector exporter config.
# This script only ensures the topic exists.
#
# Phase A: 6 partitions / 1 replica (single-node dev cluster). For prod,
# bump --replicas to 3 (and run a 3-broker Redpanda cluster).
# ============================================================================
set -euo pipefail

BROKER="${REDPANDA_BROKER:-redpanda:9092}"
TOPIC="${REDPANDA_TRACES_TOPIC:-traces}"
PARTITIONS="${REDPANDA_TRACES_PARTITIONS:-6}"
REPLICAS="${REDPANDA_TRACES_REPLICAS:-1}"

echo "[redpanda-bootstrap] ensuring topic ${TOPIC} (partitions=${PARTITIONS}, replicas=${REPLICAS}) on ${BROKER}"

# `rpk topic create` returns non-zero if the topic exists; we tolerate that.
if rpk topic create "${TOPIC}" \
    --brokers "${BROKER}" \
    --partitions "${PARTITIONS}" \
    --replicas "${REPLICAS}" 2>&1 | tee /tmp/topic-create.log; then
  echo "[redpanda-bootstrap] topic ${TOPIC} created"
elif grep -q -i "already exists\|TOPIC_ALREADY_EXISTS" /tmp/topic-create.log; then
  echo "[redpanda-bootstrap] topic ${TOPIC} already exists — skipping"
else
  echo "[redpanda-bootstrap] FAILED to create topic ${TOPIC}"
  cat /tmp/topic-create.log
  exit 1
fi

rpk topic list --brokers "${BROKER}"
echo "[redpanda-bootstrap] done"
