# Аудит изменений Астафурова и сохранности разделения — 05.10.2026

> Исторический срез до повторного fetch. В более позднем срезе Factory develop продвинулся до `8c8c276`: новый commit Астафурова `c3dd7ef` от 5 октября меняет модель Interviewer на Qwen3.5-35B-A3B. Поэтому вывод ниже об отсутствии новых коммитов после 30 сентября относится только к раннему срезу. Актуальное дополнение и сравнение тестов с baseline находятся в [разборе ревью](review-resolution-20261005.md#свежий-factory-develop).

Аудит выполнен после fetch всех четырёх репозиториев. Анализируются реальные `origin/main` и `origin/develop`, а не только текущие локальные checkout. Код, ветки, deployments, БД и remote refs в рамках аудита не изменялись. Этот документ фиксирует исходное состояние на момент fetch, до любых последующих действий основного агента.

## Основной вывод

После последних настоящих feature-коммитов пользователя от 30 сентября новых коммитов Астафурова в проверенных main/develop нет. Последние его feature-коммиты датированы 27–28 сентября. Основная текущая проблема — несогласованное продвижение уже подготовленной интеграции между репозиториями и ветками.

Backend develop уже содержит результат объединения с сохранённым разделением сервисов. Backend main остаётся монолитным. Frontend main и develop ещё не содержат объединённую ветку, хотя она опубликована отдельно. Поэтому текущие ветки develop backend/frontend не составляют согласованный релиз.

## Срез веток

| Репозиторий | origin/develop | origin/main | Где результат интеграции / смысл |
| --- | --- | --- | --- |
| benchmark-catalog-back | `25b9a25` | `f13416b` | Интеграция Oct2 уже в develop; main ещё монолит. |
| benchmark-catalog-front | `4a68021` | `8160352` | Интеграция `9468e4c` только в `origin/codex/reconcile-microservices-20261002`; ни в main, ни в develop её нет. |
| benchmark-service | `49f52f2` | `49f52f2` | Одинаковый актуальный сервис; пользовательская доменная реализация сохранена, сверху DevOps Захара. |
| agent-bench-factory | `72b6b03` | `1bdbc02` | Develop содержит новый Producer adapter и Qwen397B; main — предыдущий batch producer и Qwen27B. |

`backend origin/main` — предок develop, но между ними 141 дополнительных commit по графу, не 141 новая feature. Frontend integration включает историю develop и main; соответственно 26 и 43 дополнительных commit. Число коммитов не является числом потерянных функций.

Локальный checkout backend/frontend — integration-ветки, benchmark-service — старый `bec7939`, factory — main `1bdbc02`. Проверка только локальных файлов дала бы неправильный ответ о том, что реально попало в серверные ветки.

## Авторы и корректная точка отсчёта

Астафуров идентифицирован как `Danil Astafurov <danil31219as@gmail.com>` и `Астафуров Данил Дмитриевич <ddastafurov@sberdevices.ru>`. Захар — `zikondratyuk` / `Кондратюк Захар Игоревич`, email `zikondratyuk@sberdevices.ru`; его изменения не смешиваются с аудитом Астафурова.

| Репозиторий | Последний самостоятельный commit пользователя до интеграции | Архитектурная checkpoint-ветка | Последний feature-коммит Астафурова в текущих refs |
| --- | --- | --- | --- |
| Backend | `9c77e35`, 30.09 22:23 MSK — выбор Inventor examples для Producer | `new-microservice` = `3c8d59d`, 30.09 18:47 — изоляция истории по владельцу | `9a33645`, 27.09 23:56 — legacy interviewer search |
| Frontend | `5b05f5b`, 30.09 22:23 MSK — выбор generated tasks | `new-microservices` = `f1c3715`, 30.09 18:47 — изоляция chat history | `6ded0c6`, 28.09 00:26 — прямое создание из рекомендаций |
| Benchmark Service | `bec7939`, 30.09 17:47 MSK — Kafka mTLS | Та же ревизия | Коммитов Астафурова нет. |
| Factory | `ff31ca8`, 09.06 15:30 MSK — initial commit Сорокина; отдельных KeoFoxy feature-коммитов не найдено | Ветки split в этом репозитории нет | `8628df9`, 28.09 14:30 — Qwen3.5-397B-A17B-Thinking |

Коммиты `0a5db27` / `783648a` и merge `25b9a25` / `9468e4c` от 2 октября — наша интеграция, не новая исходная точка для истории пользователя. Последние non-merge feature-коммиты Сорокина в backend/frontend — `bf80b43` / `33e9297` от 28 июля, более ранние, чем KeoFoxy от сентября.

Есть два разных вопроса: «написано после 30 сентября» и «отсутствовало в моей отдельной split-ветке». В первом случае ответ — новых изменений Астафурова нет. Во втором граф истории содержит 38 его non-merge коммитов backend, 12 frontend, 59 Factory относительно его initial commit. Часть из них была перезаписана, отменена или затем заменена; их нельзя все подряд cherry-pick как независимые актуальные функции. Полный список ниже.

## Сохранность пользовательских функций

| Функция пользователя | Backend develop | Backend main / frontend main+develop |
| --- | --- | --- |
| Отдельный Benchmark Service как владелец Benchmark/Test; каталог хранит read projections | Сохранено; все файлы `src/benchmark-service`, `src/catalog/projection` побайтно совпадают с `3c8d59d`. | Backend main содержит монолитные `benchmark_tests`/`benchmarks` и прямую работу с ними. |
| Kafka Outbox/Inbox, async commands/status, retry/DLQ | Сохранено; `src/kafka` и `scripts/patch-kafkajs.cjs` не менялись относительно split base. | Frontend main/develop не содержат `src/api/catalog/operations.ts` и ожидают объект Test сразу после POST/PATCH, а новый backend возвращает `202`/operationId. |
| Публикация/модерация отдельно от Test, Metric rules, analytics и external API | Критичные исходники catalog-entry, benchmark-test/suite, metrics, analytics, external-api не менялись относительно split base. | Frontend main/develop не содержат submissions API/UI и связанных новых правил. |
| Исходные split-миграции | Все прежние миграции сохранены; добавлена только `20261002010000_add_generation_jobs`. | Backend main имеет другой миграционный/монолитный runtime; требуется отдельный rollout/data plan. |
| Chat ownership fix, owner-scoped cache | Backend develop содержит `3c8d59d` и generation/production owner checks. Front integration сохраняет `f1c3715`. | Front main/develop query keys не включают userId; пользовательский ownership/cache fix ещё не выпущен в эти ветки. |
| Выбор generated seeds `9c77e35` / `5b05f5b` | Backend develop сохраняет selectedIndices, creatorJobId и defensive checks. | Backend main и frontend main/develop ещё без пользовательского selected-seed UI/API. |
| mTLS Kafka Sep30 | Backend develop и Benchmark Service актуальных веток читают PEM и передают ssl. | В backend main есть Vault annotations с PEM, но его Kafka runtime вообще не передаёт `ssl`. Full CA-chain commit сам по себе runtime fix не заменяет. |

Отдельно проверено отсутствие diff пользовательских критичных backend директорий, а также отсутствие diff front integration против `f1c3715` в `src/api/catalog`, Dashboard, AdminPanel, NewBenchmark, Profile. Это сильнее проверки ancestry: дерево исходников тоже сохранено. Пользовательские изменения не потеряны в integration refs/checkpoints, однако не все продвинуты в main/develop.

## Что из изменений Астафурова перенесено

| Группа / основные коммиты | Backend develop / front integration | Что осталось в текущих main/develop |
| --- | --- | --- |
| GigaChat OAuth embeddings, endpoint env, token refresh, chunking — `45c4c62`, `e6258cd` | Перенесено как opt-in `EMBEDDING_PROVIDER=gigachat`; исходные Qwen/OpenAI-compatible/mock конфиги сохранены. | Backend main включает GigaChat жёстко и с другим поисковым слоем. |
| Qwen/Factory выбор и explanations, несколько карточек — `754b02e`, `9460d4c`; front `007623a`, `4aa9dc4` | Сохранено как opt-in Factory selection. Внутри `testId`, на внешней legacy границе `benchmarkId`. После выбора проверяются publication и source version. Пустой успешный выбор остаётся пустым. | Старые main/develop frontend ждут `benchmarkId` и не соответствуют каноническому контракту нового backend. |
| Durable Inventor jobs, восстановление interview state, progress/ETA, complete/fail/cancel/retry — `c072ab5`, `ee1f266`, `a773134`, `1a5574d`, `ddd8f1a`, `8d3a582`; front `bce6e82`, `d50aa71`, `bc95f46` | Перенесено с auth владельца, сериализацией действий, WS resource limits, корректным reconnect и generating state. | Старые frontend ветки имеют прежнюю реализацию, но не пользовательские account-scope/async corrections. |
| Producer — `547674e`, `4e26f3d`; front `6d86d2d`, `fad2969` | API/leases/results, dataset_type, equal variants, quality-filtered partial results сохранены; пользовательский selected seed поверх них. | Factory develop новый adapter совместим по форме с backend develop. Backend main dataset_type не передаёт и требует точное число результата. |
| Создание из рекомендаций — front `6ded0c6` | Перенесено в front integration с сохранением исходного rejection-to-create поведения. | Front develop содержит оригинальную версию; main ещё без этой последней правки. |
| Legacy interviewer search — `9a33645` | Сохранён endpoint, но SQL переписан на published/ready projections; dataset из snapshot. | В исходном commit SQL обращался к монолитным таблицам. |
| Model error/progress diagnostics | Сохранены полезные service/request/progress logs; полная модельная диагностика Factory остаётся в Factory. | Полное копирование старого backend logging/fallback пути не делалось. |

## Что сознательно не переносилось

| Изменение | Причина и текущий статус |
| --- | --- |
| Автозамена каталога Q3 и startup seed/sync — `e62fce1`, `ded081a`, `8f44459` | Меняет данные каталога при запуске и работает через монолитное владение. Backend develop сохраняет Kafka-backed `seed:catalog`; main всё ещё выполняет `catalog:sync:prod` и `search:sync:prod`. |
| Monolith SQL/Prisma Benchmark/Test и vector triggers | Несовместимо с отдельным Benchmark Service. Старые версии сохранены в checkpoint/history. |
| Hybrid FTS/RRF и text fallback `5b82e80` как замена исходного search | Исходный projection vector retrieval/reranker сохранён; legacy substring endpoint перенесён отдельно. Полный fallback не включался. |
| Поиск unpublished validation cards | В split публичные рекомендации/legacy search показывают только published; main search содержит `validation_status IN ('published','validation')`. |
| Tokenless mock runtime/прошлые временные credential overrides — `8e27349`, `3059065` и прежние Factory диагностические token commits | Production auth и внешняя конфигурация сохранены; временные обходы не восстанавливались. Значения секретов не извлекались. |
| Unrelated MAS redesign `e6e3ffc` | Сохранён пользовательский UI разделения; дизайн остался в старых frontend main/develop, не в integration. |
| Промежуточные enable/disable migrations, random/mock vector эксперименты | Не являются текущими отдельными фичами. Сохранён split startup и реальная pgvector-интеграция. |

## Factory и Benchmark Service

Factory не редактировался при объединении. Его develop поверх main содержит пять non-merge commits: `bbcfbfa` синхронизация, `9c3b9b0` creation workflow/Vault Redis, `3370bff` новый Producer adapter, `12c4b0a` промежуточный Qwen397B-FP8, `8628df9` финальный Qwen397B-Thinking. Последний supersedes предыдущую смену модели.

| Пара | Статус по коду |
| --- | --- |
| Backend develop + Factory develop | Подготовленная актуальная пара: dataset_type, кратность selected seeds, частичный результат и legacy mapping совпадают. Live LLM/Redis проверка отдельно необходима. |
| Backend main + Factory main | Предыдущий монолитный сценарий с batch producer. Не содержит разделения. |
| Backend main + Factory develop | Несовместим Producer: обязательный dataset_type отсутствует в claim; partial results запрещены backend. |
| Backend develop + старый Factory main | Может обслуживать старый batch producer, но не даёт нового адаптера и актуальной model/Redis конфигурации. Не считать эквивалентом целевой пары. |

Factory develop использует `Qwen3.5-397B-A17B-Thinking` для интервью, `Qwen3.8-27B-Thinking` для Inventor, producer solver panel включает Qwen3.5-35B-A3B/Gemma; default storage в `generation.toml` — Redis. Main использует более старые model/storage defaults. Для целевого creation workflow нужно явно согласовать `CATALOGUE_WORKFLOW=creation`, `creator_base_url` с `/api`, backend `THIRD_PARTY_API_KEY` = Factory `SERVICE_AUTH_TOKEN`, Redis и доступность моделей.

В Benchmark Service после `bec7939` находятся только шесть коммитов Захара: `1dff0bc`, `e142612`, `231214f`, `928af95`, `3b2c80e`, `49f52f2`. `src`, `test`, `prisma`, `package.json` между пользовательской точкой и текущим main/develop не изменились. Сохранены отдельный Prisma runner, KafkaJS patch, сборка Docker из CI artifacts, manual dev/prod deploy и полная CA chain.

## Release blockers и проверки перед запуском

1. Продвижение front integration ещё не выполнено в main/develop. Нельзя выкатывать текущий front develop с back develop как согласованную пару: async receipts, Test identifiers, submissions и ownership cache различаются.
2. Backend main ещё монолит и без пользовательского Kafka mTLS runtime. Наличие Vault PEM в values не доказывает подключение Kafka с SSL.
3. Нельзя смешивать backend main с новым Factory develop Producer.
4. При переключении main на split необходим backup/план данных: исходные split-миграции удаляют старые source tables. Git merge/откат приложения не восстанавливает БД. Следовать существующему `docs/deployment.md`, ничего не очищать по результату этого аудита автоматически.
5. GigaChat/Factory optional features требуют согласованных Vault env; переключение embeddings требует нового spec и reindex. На backend develop они не включаются только от факта наличия кода.
6. mTLS smoke должен проверить оба приложения в реальном pod с полной CA chain, сертификатом/ключом и ACL на нужные Kafka topics. Локальные тесты без corporate Kafka этого не доказывают.

Авторизованный чат «Настроить Kafka mTLS для сервисов» (`01a0f2b0-93d0-73f3-a9c7-8fb7e230019c`) подтверждает исходное требование пользователя: порт 9094, обязательные `ssl: {ca, cert, key}`, пути `/vault/secrets/kafka-*.pem` с env overrides. Там проверялись локальные тесты/сборка, подключения к реальному MSK/Vault не было. Эта история согласуется с Sep30 user commits и Oct2 CA-chain дополнением Захара.

## Безопасная локальная regression-проверка

Этот раздел описывает подходящий запуск; сам аудит тестовые сервисы не поднимал.

- Backend: `scripts/run-e2e-tests.js` создаёт отдельный compose project `benchmark-catalog-e2e`, PostgreSQL pgvector с tmpfs и loopback-port 55432 (переопределяется `BENCHMARK_TEST_DB_PORT`), использует фиксированный test DB URL, принудительные mock ML и Kafka disabled, выполняет migrate reset и снимает disposable container в finally. До запуска убрать внешний `TEST_DATABASE_URL` и явно проверить, что переменная не указывает на чужую БД. Скрипт допускает внешний URL только по наличию `test` в имени БД — это не гарантия localhost.
- Backend test e2e выполняют deleteMany/reset, поэтому запускать их только в таком disposable контуре; unit/HTTP/PGlite и seed preflight не заменяют живую проверку Kafka.
- Benchmark Service: обычный `local/docker-compose.yml` использует persistent volume и порты 55433/19092, не только loopback. Не использовать этот общий dev compose как disposable regression по умолчанию. Для regression нужен отдельный project/volume или tmpfs, уникальные loopback ports, отдельная test DB и local-only broker/topic names. `test:e2e` и Kafka e2e напрямую удаляют строки в configured DB без защитного test-name guard.
- Factory: `pytest` собирает `tests/`, model clients обычно заменены mock, `fakeredis` доступен в dev dependencies. Проверять актуальный develop, а не локальный старый main. `scripts/smoke_qwen_api.py`, `smoke_gigachat_api.py`, `smoke_fulltext_gigachat.py` — отдельные live checks с credentials/квотой; не включать их незаметно в обычную регрессию.
- Frontend: full lint/build/test нужно выполнять именно на integration commit; прохождение старого develop не подтверждает исправность split UI.

В документе Oct2 зафиксированы 370 backend unit/HTTP/PGlite tests, 88 PostgreSQL e2e, 7 seed tests и 270 frontend tests. Это исторический результат Oct2, не новый прогон Oct5. Результаты нового прогона должны быть записаны отдельно основным агентом.

## Полный перечень non-merge коммитов Астафурова, отсутствовавших в исходной user checkpoint

Ниже графовый перечень, а не утверждение о календарном порядке или необходимости восстановить каждый diff. Он включает superseded эксперименты; оценки переноса приведены выше. SHA в текущей integration ancestry не гарантирует неизменность дерева.

### benchmark-catalog-back — 38 commits

| SHA | Дата автора | Commit subject |
| --- | --- | --- |
| `9a33645` | 2026-09-27 | Add legacy interviewer benchmark search endpoint |
| `4e26f3d` | 2026-09-27 | Pass Inventor dataset type to Producer jobs |
| `01721bd` | 2026-09-23 | Sync main into develop for dev deployment |
| `e62fce1` | 2026-09-23 | Replace catalog with Q3 benchmarks and vectorize on deploy |
| `547674e` | 2026-09-23 | Add producer job API for benchmark scaling |
| `9460d4c` | 2026-09-23 | Return multiple benchmark recommendations by default |
| `ded081a` | 2026-09-22 | Import missing catalogue tests before pgvector sync |
| `8f44459` | 2026-09-22 | Sync missing search documents automatically after startup |
| `412b6e8` | 2026-09-22 | Log diagnostics when hybrid search returns no candidates |
| `cd94b46` | 2026-09-22 | Log full errors when search falls back without a model |
| `8d3a582` | 2026-09-22 | Allow owners to cancel Inventor generation |
| `ddd8f1a` | 2026-09-22 | Expose Inventor LLM call progress and estimated completion |
| `1a5574d` | 2026-09-22 | Fix Inventor job handoff failing on PostgreSQL void lock |
| `a773134` | 2026-09-22 | Restore durable Inventor jobs and interview state |
| `3f972ca` | 2026-09-21 | Log reasons for recommendation selection without a model |
| `e6258cd` | 2026-09-21 | Read GigaChat endpoints from env and preserve text fallback |
| `ea9d8f1` | 2026-09-21 | Release GigaChat search and fallback to main without conflicts |
| `ca574e0` | 2026-09-21 | Reconcile main history in develop for release |
| `5b82e80` | 2026-09-21 | Use GigaChat embeddings with PostgreSQL text search fallback |
| `b23165c` | 2026-09-21 | Release catalogue backend to main with Vault-managed credentials |
| `e99964c` | 2026-09-20 | Require real model providers in deployed catalogue backend |
| `754b02e` | 2026-09-20 | Restore Qwen recommendation selection and search validation cards |
| `45c4c62` | 2026-09-20 | Add GigaChat embeddings and PostgreSQL hybrid search |
| `452a36e` | 2026-09-17 | Expose inventor progress and all generated tasks to interview owners |
| `3059065` | 2026-09-17 | Configure temporary shared token for inventor integration |
| `ee1f266` | 2026-09-17 | Fix inventor request parsing and concurrent progress updates |
| `c072ab5` | 2026-09-17 | Add durable inventor job execution and result delivery |
| `834c117` | 2026-09-15 | Restore startup migrations and fix pgvector constraint name |
| `966d8c4` | 2026-09-15 | Disable automatic startup migrations for database recovery |
| `2ea012e` | 2026-09-15 | Enable Prisma migrations before backend startup |
| `6d61812` | 2026-09-07 | Add full-text catalogue test search without pgvector |
| `3fe3498` | 2026-09-05 | Fix CSRF blocking of interviewer service requests |
| `f976aaa` | 2026-09-05 | Return random catalogue tests for GigaChat smoke deployment |
| `8e27349` | 2026-09-05 | Enable tokenless factory chat for mock deployments |
| `5983fda` | 2026-09-05 | Disable database migrations at application startup |
| `c2af804` | 2026-09-04 | Restore pgvector storage |
| `7eb27d1` | 2026-09-04 | Mock vector storage without pgvector |
| `2446401` | 2026-09-04 | Codex/interviewer integration |

### benchmark-catalog-front — 12 commits

| SHA | Дата автора | Commit subject |
| --- | --- | --- |
| `6ded0c6` | 2026-09-28 | Create benchmark directly from recommendations |
| `fad2969` | 2026-09-27 | Show Producer variant counts and accepted results |
| `1ddfc99` | 2026-09-23 | Sync main into develop for dev deployment |
| `6d86d2d` | 2026-09-23 | Add producer scaling after Inventor generation |
| `4aa9dc4` | 2026-09-23 | Show separate actions for multiple benchmark recommendations |
| `e6e3ffc` | 2026-09-22 | Apply MAS design concept to frontend |
| `bc95f46` | 2026-09-22 | Add generation cancellation and restart controls |
| `d50aa71` | 2026-09-22 | Show Inventor LLM call progress and remaining time |
| `bce6e82` | 2026-09-22 | Restore generation progress and results in creation chat |
| `007623a` | 2026-09-20 | Show Qwen recommendation explanations in chat and history |
| `645e1db` | 2026-09-17 | Show generation progress and all generated tasks after interviews |
| `65f1bf9` | 2026-09-04 | Codex/interviewer integration |

### benchmark-service — 0 commits

Коммитов Астафурова нет.

### agent-bench-factory — 59 commits

| SHA | Дата автора | Commit subject |
| --- | --- | --- |
| `8628df9` | 2026-09-28 | Switch Interviewer to Qwen3.5-397B-A17B-Thinking |
| `12c4b0a` | 2026-09-28 | Use Qwen3.5-397B-A17B-FP8 for Interviewer |
| `3370bff` | 2026-09-27 | Connect benchmark producer to catalogue |
| `9c3b9b0` | 2026-09-27 | Restore creation workflow and use Vault Redis |
| `bbcfbfa` | 2026-09-23 | Sync main into develop for dev deployment |
| `38c1db4` | 2026-09-23 | Add benchmark production from Inventor results |
| `dfdcbbc` | 2026-09-22 | Squashed 'vendor/bench-factory/' changes from 0485523..77eea0f |
| `e3a56f0` | 2026-09-22 | Normalize gateway text blocks before structured response parsing |
| `72ad553` | 2026-09-22 | Log raw SDK response contents and verify cancellation cleanup |
| `5da5020` | 2026-09-22 | Calculate Inventor ETA from the maximum LLM call budget |
| `4990150` | 2026-09-22 | Track Inventor mutation progress and allow hour-long runs |
| `b40b7b6` | 2026-09-22 | Fix Inventor generation recovery and completion budgets |
| `cdbae90` | 2026-09-22 | Log Inventor backend HTTP status and route |
| `d5bca7c` | 2026-09-22 | Apply Inventor TLS setting to LangChain HTTP clients |
| `e781502` | 2026-09-22 | Log skipped Inventor stages without false errors |
| `2de05ef` | 2026-09-22 | Use Inventor result selection and expose validator stage logs |
| `745c805` | 2026-09-22 | Restore Qwen3.8 Thinking as Inventor generator |
| `178ebee` | 2026-09-22 | Update Inventor generator and solver models |
| `436521d` | 2026-09-22 | Adapt Inventor JSON mode to the gigahf gateway |
| `d539569` | 2026-09-22 | Remove service-side restrictions on Inventor task content |
| `ea4f6a9` | 2026-09-22 | Remove obsolete Redis deployment jobs and Helm values |
| `6de89ce` | 2026-09-22 | Use per-job in-memory Inventor storage without deployment PVCs |
| `0a77367` | 2026-09-22 | Restore creation interviews and Inventor handoff with local Redis testing |
| `f244cde` | 2026-09-21 | Handle model text parts and log complete model responses |
| `2b3ad43` | 2026-09-21 | Log full correlated tracebacks for response and WebSocket errors |
| `df40e46` | 2026-09-21 | Load model endpoints and credentials exclusively from environment |
| `8021cce` | 2026-09-21 | Use Qwen3.8-27B-Thinking for all generation roles |
| `89f501b` | 2026-09-21 | Fix GigaChat creation replies and reconcile main history |
| `5b88baf` | 2026-09-21 | Codex/gigachat dev pinned |
| `7cf6b58` | 2026-09-21 | Codex/gigachat dev pinned |
| `12c5dcd` | 2026-09-21 | Codex/gigachat dev pinned |
| `ebec751` | 2026-09-21 | Load Factory credentials from Vault without embedded fallbacks |
| `ba92a5c` | 2026-09-21 | Prevent environment from overriding configured models |
| `96694a1` | 2026-09-21 | Configure independent interviewer and inventor models on IFT |
| `eb5a9dc` | 2026-09-21 | Use Qwen/Qwen3.5-27B-Thinking with temperature 0.7 |
| `861953b` | 2026-09-21 | Update pinned Qwen diagnostic token |
| `04de33c` | 2026-09-21 | Pin Qwen token to isolate deployment authentication failure |
| `f7cc159` | 2026-09-20 | Preserve Vault Qwen tokens and diagnose authentication failures |
| `ce6ae69` | 2026-09-20 | Require real Qwen calls in deployed Factory runtime |
| `ce1782d` | 2026-09-20 | Select backend recommendation candidates with Qwen |
| `0278f28` | 2026-09-20 | Adapt catalogue creation workflow and external Redis configuration |
| `4cb9163` | 2026-09-18 | Add configurable TLS verification for brief and inventor models |
| `911039f` | 2026-09-18 | Log full model error tracebacks with credential redaction |
| `c422824` | 2026-09-18 | Log brief and inventor model requests in pod output |
| `d5f69fb` | 2026-09-17 | Configure inventor smoke test and report completed generations |
| `0c4ce18` | 2026-09-17 | Add temporary local Redis for dev inventor runs |
| `4f331b9` | 2026-09-17 | Configure temporary service token for enabled inventor |
| `f38ba21` | 2026-09-17 | Add enabled inventor worker with vendored generation engine |
| `9ed2d33` | 2026-09-15 | Squashed 'vendor/bench-factory/' content from commit 0485523 |
| `84ffb59` | 2026-09-15 | Use development GigaHF endpoint for Qwen generation |
| `134eca6` | 2026-09-15 | Switch factory generation to Qwen through OpenAI SDK |
| `4f32223` | 2026-09-07 | Add full-text search with GigaChat-2-Max selection |
| `d10d925` | 2026-09-05 | Recover factory readiness after catalogue startup failures |
| `7a0fa73` | 2026-09-05 | Enable GigaChat API with random catalogue retrieval |
| `f35b4d7` | 2026-09-04 | Disable vector HTTP calls in mock mode |
| `672ff9f` | 2026-09-04 | fix: allow tokenless mock smoke deployment |
| `c50f145` | 2026-09-04 | fix: use available Python 3.11 image |
| `6659f7b` | 2026-09-04 | fix: repair factory deployment image |
| `e5c3960` | 2026-09-04 | Interviewer |
