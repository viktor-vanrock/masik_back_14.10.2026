# Reconciliation of microservices with develop/main — 2026-10-02

The implementation base is `new-microservice` (`3c8d59d`). The reconciliation incorporates the history of `origin/develop` (`00b6ce2`), `origin/main` (`f13416b`) and the separate user change `codex/select-generation-tasks` (`9c77e35`) while keeping Benchmark/Test ownership in Benchmark Service.

## Preservation

No original microservice-branch file was deleted. Existing Kafka, Outbox, command/projection, catalog publication/moderation, benchmark read/write, metrics and analytics implementation files are unchanged. All pre-existing microservice migrations are unchanged. The original `new-microservice`, local develop/main and remote heads have independent checkpoint refs and verified Git bundles.

Checkpoint namespace: `codex/checkpoint-20261002T115529Z/`. `fetched-new-microservice`, `fetched-develop`, `fetched-main` refer to refreshed server heads; `checkout` preserves the separate selected-task work. `local-*` and `origin-*` also preserve pre-fetch local and cached heads. Checkpoints were pushed with CI skipped. Recover into a new branch, for example:

```sh
git switch -c recovery/microservices origin/codex/checkpoint-20261002T115529Z/fetched-new-microservice
```

Local bundles and the full SHA manifests are in the workspace's `merge-safety/20261002T115529Z/`; `git bundle verify <bundle>` and `git clone <bundle> <new-directory>` can verify/recover independently of the server.

## Compatible functionality carried forward

- GigaChat OAuth embeddings, shared token refresh, bounded multilingual chunks, normalized pooling and isolated embedding specification. Existing mock/OpenAI-compatible/Qwen providers and Qwen query instruction/truncation remain supported.
- Optional Factory recommendation selection with explanation and multiple-result support. Internally the identifier remains `testId`; only the legacy Factory HTTP/WS boundary uses `benchmarkId`. Catalog revalidates publication and source versions before committing recommendations. A successful empty Factory selection remains empty; transport failures may use retrieval order.
- Inventor and Producer durable leased jobs, progress, results, cancel/retry, selected seed indices and creator-job identity. Producer receives `dataset_type`, validates divisibility against selected seeds and accepts quality-filtered partial results.
- Owner-scoped generation/production APIs, preserved conversation action serialization/idempotency and WebSocket resource limits. Interviewer reconnect replays current state; generating conversations cannot restart the interviewer.
- Legacy interviewer search endpoint backed exclusively by published, ready Kafka projections.
- One additive migration `20261002010000_add_generation_jobs`, including compatibility with existing current main/develop generation tables and selected-index backfill. No legacy vector-trigger migration is imported.
- Latest Zakhar Kondratyuk Vault/Kafka CA chain, PKI, image-pull-secret and standalone shared Redis deployment changes. See `envs/README-reconciliation-20261002.md`. CI applies the KafkaJS patch without moving Prisma generation from its dedicated runner.

## Deliberately excluded

The monolithic Benchmark/Test schema and direct writes, Q3 automatic catalog replacement/startup sync, monolith-dependent vector triggers/search, and unrelated visual redesign are not carried forward. Existing projection search/reranker and Kafka seed pipeline remain the default. These excluded versions remain recoverable from checkpoints.

## Runtime choices

GigaChat is opt-in, preserving the original provider configuration:

```dotenv
EMBEDDING_PROVIDER=gigachat
EMBEDDING_MODEL=Embeddings-2
EMBEDDING_DIMENSIONS=1024
EMBEDDING_SOURCE_DIMENSIONS=1024
GIGACHAT_BASE_URL=https://<gigachat-host>/<api-prefix>
GIGACHAT_AUTH_URL=https://<authorization-host>/<oauth-path>
GIGACHAT_CREDENTIALS=<from-vault>
GIGACHAT_SCOPE=GIGACHAT_API_CORP
RECOMMENDATION_SELECTION_PROVIDER=factory
FACTORY_SELECTION_URL=https://<factory-host>/api/v1/recommendations/select
```

Remove a prior `EMBEDDING_SPEC_ID` override when changing provider, so the provider-specific specification is used. Rebuild the search index with the existing reindex command after the provider change. `RECOMMENDATION_SELECTION_PROVIDER=reranker` retains the original path; Factory selection does not require a reranker URL.

Factory must use `CATALOGUE_WORKFLOW=creation`; its `creator_base_url` includes `/api`, and `SERVICE_AUTH_TOKEN` matches backend `THIRD_PARTY_API_KEY`. The refreshed Factory develop `72b6b03` contains the current Producer adapter; Factory was audited and backed up, not modified by this reconciliation. Benchmark Service's current `49f52f2` includes the latest deployment/CA-chain changes and should be used with this catalog.

## Validation

- Backend lint, source/test typecheck, production build: passed.
- Backend full unit/HTTP/PGlite suite: 47 suites, 370 tests passed.
- PostgreSQL e2e: 19 suites, 88 tests passed, including projection ownership/visibility, asynchronous writes/status, Outbox leasing, conversation ownership and action idempotency. The disposable test container was removed.
- Kafka-backed catalog seed preflight: 7 tests passed.
- Frontend lint and production build: passed; 44 suites, 270 tests passed.
- YAML, shell syntax and preservation checks: passed; no original microservice migrations or critical domain files changed.

These are automated local checks; live GigaChat/Factory credentials and an end-to-end deployment in the corporate environment were not exercised. No real database, Kafka topic or deployment was changed.

## Deployment boundary

This Git reconciliation is not a production data migration. The original split migrations remove old monolith tables; follow `docs/deployment.md` with separate Catalog/Benchmark Service databases and a database backup before rollout. Do not run those migrations blindly against a live monolith database. Original branches remain checkpoints; reverting application code alone does not reverse database migrations.
