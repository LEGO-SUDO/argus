# Argus — DOKS deployment runbook

End-to-end deploy: **web → Vercel**, everything else → a **DigitalOcean Kubernetes (DOKS)** cluster, **Postgres → Neon** (managed, free tier), **Redpanda in-cluster**.

```
            Vercel (web)                         Neon (Postgres, managed)
                │  rewrites /api/* ──┐                    ▲
                │  browser WSS ──────┤                    │ DATABASE_URL (sslmode=require)
                ▼                    ▼                    │
   ┌──────────────── DOKS (namespace: argus) ────────────┼───────────┐
   │  ingress-nginx (1 LB) + cert-manager (Let's Encrypt)│           │
   │     https://api-argus.duckdns.org  wss://…/ws/chat  │           │
   │            ▼                                         │           │
   │          api ◄──── db-migrate Job (prisma deploy) ──┘           │
   │            │                                                     │
   │         workers ──► redpanda (StatefulSet) ◄── otel-collector ──► jaeger
   └─────────────────────────────────────────────────────────────────┘
```

## Cost (approx, monthly)

| Item | Choice | Cost |
|---|---|---|
| DOKS control plane | managed | **$0** |
| Worker node | `s-4vcpu-8gb` ×1 (recommended) | ~$48 |
| _(cheaper, tighter)_ | `s-2vcpu-4gb` ×1 | ~$24 |
| Load Balancer | 1× DO LB (ingress) | ~$12 |
| Container Registry | DOCR Starter | $0 (Basic ~$5) |
| Postgres | Neon free tier | $0 |
| Block storage | 10Gi PVC (Redpanda) | ~$1 |
| Web | Vercel Hobby | $0 |
| **Total** | | **~$37–61/mo** |

> The single biggest footprint is Redpanda (1Gi) + Jaeger + ingress + cert-manager on one node. `s-2vcpu-4gb` *can* fit it but you risk `Pending`/evicted pods — start with `s-4vcpu-8gb` unless you're cost-pinching. If you ever want it cheaper still, k3s on a Hetzner CPX31 runs the identical manifests for ~€14/mo.

---

## Prerequisites (local)

```bash
brew install doctl kubectl kustomize   # macOS
doctl auth init                         # paste a DO API token (Account → API)
```

## 1. Neon Postgres

1. Create a project at https://neon.tech → database name `argus`.
2. Copy the **direct** (unpooled) connection string and append `?sslmode=require`:
   `postgresql://USER:PASS@ep-xxx.REGION.aws.neon.tech/argus?sslmode=require`
3. Hold onto it for the Secret in step 5.

## 2. DOKS cluster + DOCR

```bash
# Cluster (one node pool; bump size/count later if pods go Pending)
doctl kubernetes cluster create argus-prod \
  --region blr1 \
  --node-pool "name=pool;size=s-4vcpu-8gb;count=1" \
  --wait
# kubeconfig is merged automatically; verify:
kubectl get nodes

# Container registry + let the cluster pull from it
doctl registry create argus --subscription-tier starter   # name "argus"
doctl kubernetes cluster registry add argus-prod           # adds imagePullSecret
```

Then set the registry name in the overlay (replace `REPLACE_REGISTRY` with `argus`):

```bash
cd infra/k8s/overlays/prod
kustomize edit set image \
  argus-api=registry.digitalocean.com/argus/argus-api:latest \
  argus-workers=registry.digitalocean.com/argus/argus-workers:latest
cd -
```

## 3. ingress-nginx + cert-manager

```bash
# ingress-nginx (provisions the DO LoadBalancer)
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.11.3/deploy/static/provider/do/deploy.yaml

# DOKS gotcha: DO "REGIONAL_NETWORK" LB + ingress-nginx default PROXY-protocol
# mismatch → "empty reply from server" on :80/:443. Disable it on both sides
# (we don't need client-IP preservation):
kubectl patch configmap ingress-nginx-controller -n ingress-nginx --type merge \
  -p '{"data":{"use-proxy-protocol":"false"}}'
kubectl annotate svc ingress-nginx-controller -n ingress-nginx \
  service.beta.kubernetes.io/do-loadbalancer-enable-proxy-protocol="false" --overwrite
kubectl rollout restart deploy/ingress-nginx-controller -n ingress-nginx
# Do NOT set service.beta.../do-loadbalancer-hostname on a REGIONAL_NETWORK LB —
# it breaks the data path. cert-manager HTTP-01 works without any hairpin
# workaround on single-node DOKS.

# cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.16.1/cert-manager.yaml
kubectl -n cert-manager rollout status deploy/cert-manager-webhook --timeout=180s

# Let's Encrypt issuer
kubectl apply -f infra/k8s/cert-manager/cluster-issuer.yaml
```

## 4. Point DNS at the LoadBalancer

```bash
kubectl get svc -n ingress-nginx ingress-nginx-controller \
  -o jsonpath='{.status.loadBalancer.ingress[0].ip}'; echo
```

Put that IP into DuckDNS for `api-argus`:

```bash
curl "https://www.duckdns.org/update?domains=api-argus&token=YOUR_DUCKDNS_TOKEN&ip=THE_LB_IP"
# verify (may take a minute to propagate)
dig +short api-argus.duckdns.org
```

> Set DNS **before** applying the api Ingress — cert-manager's HTTP-01 challenge needs the hostname resolving to the LB to issue the TLS cert.

## 5. Secrets

```bash
kubectl create namespace argus --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret generic argus-secrets -n argus \
  --from-literal=DATABASE_URL='postgresql://USER:PASS@ep-xxx.REGION.aws.neon.tech/argus?sslmode=require' \
  --from-literal=SESSION_SECRET="$(openssl rand -hex 32)" \
  --from-literal=OPENAI_API_KEY='' \
  --from-literal=ANTHROPIC_API_KEY='' \
  --from-literal=GOOGLE_API_KEY='' \
  --from-literal=SENTRY_DSN=''
```

> Leave provider keys empty for the first deploy — `MOCK_PROVIDER=true` (in `configmap.yaml`) returns deterministic mock responses so you can verify the whole pipeline with zero LLM spend. Flip to real keys + `MOCK_PROVIDER=false` afterwards (step 8).

## 6. First deploy (manual)

```bash
# Build + push images (or just let CI do it — see below)
doctl registry login
docker buildx build --platform linux/amd64 -f apps/api/Dockerfile \
  -t registry.digitalocean.com/argus/argus-api:latest --push .
docker buildx build --platform linux/amd64 -f apps/workers/Dockerfile \
  -t registry.digitalocean.com/argus/argus-workers:latest --push .

# Apply everything
kubectl apply -k infra/k8s/overlays/prod

# Watch it come up (Redpanda first, then the bootstrap + migrate Jobs, then app)
kubectl get pods -n argus -w
kubectl wait --for=condition=complete job/db-migrate -n argus --timeout=240s
kubectl rollout status deploy/api -n argus
```

> `api`/`workers` may restart a few times while Redpanda becomes ready and the migration runs — that's expected self-healing, not a failure. Give it ~2 minutes.

Check the cert was issued:

```bash
kubectl get certificate -n argus    # api-argus-tls → READY=True
curl -I https://api-argus.duckdns.org/healthz
```

## 7. Vercel (web)

In the Vercel project (Git-connected to this repo):

- **Root Directory:** `apps/web`
- **Framework:** Next.js (auto-detected)
- **Install Command:** `pnpm install --frozen-lockfile` (run at repo root)
- **Build Command:** `cd ../.. && pnpm --filter @argus/web... build` _(builds workspace deps first)_
- **Environment Variables:**
  | Key | Value |
  |---|---|
  | `INTERNAL_API_URL` | `https://api-argus.duckdns.org` |
  | `NEXT_PUBLIC_WS_URL` | `wss://api-argus.duckdns.org/ws/chat` |
  | `NEXT_PUBLIC_API_URL` | _(empty — client uses relative `/api/*` via rewrites)_ |

Deploy. The browser loads from Vercel, REST is proxied server-side to the API, and the chat WebSocket connects directly to `wss://api-argus.duckdns.org/ws/chat`.

## 8. Go live with real providers

```bash
kubectl patch configmap argus-config -n argus --type merge -p '{"data":{"MOCK_PROVIDER":"false"}}'
kubectl create secret generic argus-secrets -n argus \
  --from-literal=DATABASE_URL='…' --from-literal=SESSION_SECRET='…' \
  --from-literal=OPENAI_API_KEY='sk-…' --from-literal=ANTHROPIC_API_KEY='sk-ant-…' \
  --from-literal=GOOGLE_API_KEY='…' --from-literal=SENTRY_DSN='…' \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl rollout restart deploy/api deploy/workers -n argus
```

## 9. CI/CD (subsequent deploys)

`.github/workflows/deploy.yml` builds → pushes to DOCR → migrates → rolls on every push to `main` touching `apps/api`, `apps/workers`, `packages`, or `infra/k8s`. Configure once:

- `secrets.DIGITALOCEAN_ACCESS_TOKEN` — DO API token
- `vars.DOCR_NAME` = `argus`
- `vars.DOKS_CLUSTER` = `argus-prod`

---

## Operations

```bash
kubectl get pods -n argus
kubectl logs -n argus deploy/api -f
kubectl logs -n argus deploy/workers -f
kubectl exec -n argus redpanda-0 -- rpk topic list   # traces, live-events
kubectl port-forward -n argus svc/jaeger 16686:16686 # Jaeger UI at :16686
```

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Pods `Pending` / `Evicted` | Node too small — scale the pool: `doctl kubernetes cluster node-pool update argus-prod pool --size s-4vcpu-8gb` (or `--count 2`). |
| `api`/`workers` CrashLoopBackOff at start | Redpanda not ready yet, or migration not done. Check `kubectl get job db-migrate -n argus` and Redpanda readiness. Self-heals once both are up. |
| Certificate stuck `READY=False` | DNS not resolving to the LB, or port 80 blocked. `kubectl describe certificate api-argus-tls -n argus` and confirm `dig api-argus.duckdns.org` returns the LB IP. |
| `empty reply from server` on :80/:443 | DO LB ↔ ingress-nginx PROXY-protocol mismatch. Disable on both sides (step 3). |
| Redpanda `CrashLoopBackOff`, log shows `pid.lock ... Permission denied` | DO block-storage PVC mounts root-owned; the StatefulSet's `securityContext.fsGroup: 101` fixes it — re-apply if removed. |
| cert `pending`, self-check `context deadline exceeded` | Almost always the LB data path is down — `curl` the LB IP on :80. On single-node DOKS this is **not** hairpin; don't add the hostname annotation. |
| WebSocket drops after ~60s | Ingress timeout annotations missing (`proxy-read/send-timeout: 3600` are set in `api.yaml` — re-apply if you edited the Ingress). |
| SSE feed buffers / no live updates | `nginx.ingress.kubernetes.io/proxy-buffering: "off"` must be on the api Ingress. |
| Prisma migrate fails on Neon | Ensure `?sslmode=require` and you're using the **direct** (not pooled) Neon host. |

## Notes & later hardening

- **Jaeger storage is in-memory** (ephemeral, capped at 20k traces). For persistence switch to `SPAN_STORAGE_TYPE=badger` + a small PVC in `jaeger.yaml`.
- **Redpanda is single-node** (dev-container mode). For real durability run 3 brokers and set topic `--replicas 3` in the bootstrap Job.
- **Drop the LB cost** by exposing ingress via a NodePort + the node's public IP if $12/mo matters (loses managed LB health checks).
