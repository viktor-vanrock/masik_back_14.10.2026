# Краткая инструкция по развёртыванию

Эта инструкция описывает запуск и обновление связки:

```text
Frontend -> Benchmark Catalog -> Kafka -> Benchmark Service
                   |                         |
             Catalog PostgreSQL       Benchmark PostgreSQL
```

Каталог и Benchmark Service используют **разные базы и разные учётные данные**. Общая БД, cross-database FK и прямой SQL между сервисами не нужны.

**Если контур уже содержит сохранённые 40 Test, при переходе на GigaChat
выполняйте раздел 10.** Меняется только производный поисковый индекс. Чистый
bootstrap, очистка Kafka и seed из разделов 5–7 к этому обновлению не относятся.

## 1. Что подготовить

- PostgreSQL с расширением `pgvector` для Benchmark Catalog.
- Отдельную PostgreSQL для Benchmark Service.
- Kafka, доступную обоим backend-сервисам.
- Vault для ключей внешнего API каталога.
- Доступ каталога к Factory по WebSocket и к GigaChat API/OAuth по HTTPS.
  Embeddings строит GigaChat, поиск выполняют PostgreSQL FTS и pgvector;
  отдельные Qwen embedder/reranker сервисы для этого пути не нужны.
- Внутренний адрес Benchmark Service. Его GET API сейчас не требует авторизации, поэтому без отдельного решения его не следует публиковать в интернет. Записывающие HTTP-запросы защищены `BENCHMARK_SERVICE_TOKEN`.

Если автоматическое создание Kafka-топиков отключено, заранее создать:

```text
benchmark-service.commands.v1
benchmark-service.events.v1
benchmark-service.commands.dlq.v1
catalog-service.benchmark-events.dlq.v1
catalogue.recommendation.rerank.request.v2
interviewer.recommendation.rerank.result.v2
catalogue.recommendation.rerank.result.dlq.v2
```

Количество partition, replication factor и retention задаются по правилам контура. Сообщения Benchmark/Test отправляются с `aggregateId` в качестве Kafka key, поэтому порядок сообщений одного объекта сохраняется.

## 2. ENV Benchmark Service

Обязательный минимум:

```dotenv
NODE_ENV=production
PORT=3100
DB_URL=postgresql://<user>:<password>@<host>:5432/<benchmark_db>?schema=public
BENCHMARK_SERVICE_TOKEN=<random-secret-at-least-16-characters>

KAFKA_ENABLED=true
KAFKA_BROKERS=<broker-1:9094,broker-2:9094,broker-3:9094>
KAFKA_SSL_CA_FILE=/vault/secrets/kafka-ca.pem
KAFKA_SSL_CERT_FILE=/vault/secrets/kafka-cert.pem
KAFKA_SSL_KEY_FILE=/vault/secrets/kafka-key.pem
KAFKA_CLIENT_ID=benchmark-service
KAFKA_CONSUMER_GROUP=benchmark-service-v1
KAFKA_COMMANDS_TOPIC=benchmark-service.commands.v1
KAFKA_EVENTS_TOPIC=benchmark-service.events.v1
KAFKA_COMMANDS_DLQ_TOPIC=benchmark-service.commands.dlq.v1
KAFKA_COMMAND_MAX_PROCESSING_ATTEMPTS=5
KAFKA_PUBLISH_INTERVAL_MS=250
KAFKA_RETRY_BASE_MS=1000
KAFKA_RETRY_MAX_MS=60000
KAFKA_OUTBOX_BATCH_SIZE=50
KAFKA_OUTBOX_LEASE_MS=30000
```

`KAFKA_CONSUMER_GROUP` должен принадлежать только Benchmark Service и не совпадать с группой каталога.
Сертификаты читаются при старте процесса; после их ротации перезапустите pod.

## 3. ENV Benchmark Catalog

Секреты должны приходить из хранилища секретов, а не из Git:

```dotenv
NODE_ENV=production
PORT=3000
DB_URL=postgresql://<user>:<password>@<host>:5432/<catalog_db>?schema=public

JWT_ACCESS_SECRET=<secret>
JWT_REFRESH_SECRET=<different-secret>
JWT_ACCESS_EXPIRE=7d
JWT_REFRESH_EXPIRE=7d
TRUSTED_ORIGINS=https://<frontend-host>
ORIGIN_TRUST_FORWARDED_HEADERS=false

KAFKA_ENABLED=true
KAFKA_BROKERS=<broker-1:9094,broker-2:9094,broker-3:9094>
KAFKA_SSL_CA_FILE=/vault/secrets/kafka-ca.pem
KAFKA_SSL_CERT_FILE=/vault/secrets/kafka-cert.pem
KAFKA_SSL_KEY_FILE=/vault/secrets/kafka-key.pem
KAFKA_CLIENT_ID=benchmark-catalog
KAFKA_CONSUMER_GROUP_ID=benchmark-catalog-projection-v1
KAFKA_CONNECTION_TIMEOUT_MS=5000
KAFKA_REQUEST_TIMEOUT_MS=30000
KAFKA_CONSUMER_RESTART_DELAY_MS=5000
KAFKA_CONSUMER_MAX_PROCESSING_ATTEMPTS=5
BENCHMARK_SERVICE_READ_MODE=projection
BENCHMARK_SERVICE_WRITE_MODE=remote

VAULT_ADDR=https://<vault-host>
VAULT_TOKEN_FILE=/vault/secrets/token
VAULT_TRANSIT_MOUNT=transit
VAULT_TRANSIT_HMAC_KEY=benchmark-catalog-external-api
VAULT_TIMEOUT_MS=3000

AGENT_MODE=ws
THIRD_PARTY_WS_URL=wss://<interviewer-host>/<path>
THIRD_PARTY_API_KEY=<secret>

EMBEDDING_PROVIDER=gigachat
GIGACHAT_BASE_URL=https://<gigachat-api-host>/<api-prefix>
GIGACHAT_AUTH_URL=https://<gigachat-auth-host>/<oauth-path>
GIGACHAT_CREDENTIALS=<base64-basic-credentials-without-Basic-prefix>
GIGACHAT_SCOPE=GIGACHAT_API_CORP

RECOMMENDATION_SELECTION_PROVIDER=retrieval
RECOMMENDATION_MAX_CONCURRENT_EXECUTIONS=16
```

Каталог также читает mTLS-файлы при старте. Если Kafka требует авторизацию на
уровне топиков, выданные сертификату права должны покрывать чтение и запись
топиков, используемых соответствующим сервисом, включая проверку health.
Для каталога пути `/vault/secrets/kafka-*.pem` используются по умолчанию при
подключении к порту 9094 или в production; переменные `KAFKA_SSL_*_FILE`
позволяют переопределить их, если Vault монтирует файлы в другом месте.

GigaChat endpoints и credentials обязательны для реального провайдера и должны
быть заданы именно в Vault secret **Catalog** (`rndbtoc/benchmark-catalog-back`).
Наличие этих ключей только в Factory secret не передаёт их каталогу.
`GIGACHAT_BASE_URL` — API-префикс без конечного `/embeddings`: клиент добавляет
этот путь сам. `GIGACHAT_AUTH_URL` — полный адрес OAuth. Credentials — готовая
Base64-часть Basic без слова `Basic`, а не временный access token. Клиент
получает и обновляет Bearer token самостоятельно. Использовать адреса своего
корпоративного контура; встроенного резервного адреса нет.

Для GigaChat в коде закреплены `Embeddings-2`, 1024 измерения, L2-нормализация,
чанки до 400 UTF-8 байт и взвешенное по длине объединение; spec:
`gigachat:Embeddings-2:benchmark-test-document-v1:dim-1024:l2:chunk400b-mean-v1`.
Параметры этого релиза: timeout 120000 ms, retries 2, retry delay 250 ms,
candidate limit 20, batch 16. Старые model/dimension/spec/tuning
`EMBEDDING_*` не переопределяют этот профиль.
Для интерактивного поиска действует общий бюджет 15 секунд на query embedding,
включая OAuth, чанки и retries; при его исчерпании используется FTS fallback.
Конкурентные запросы и индексация используют один OAuth-запрос с собственным
timeout; отмена отдельного поиска прекращает только его ожидание токена.
Переиндексация и общий OAuth используют полный 120-секундный timeout GigaChat.

Каждый SQL-запрос поиска (hybrid, FTS fallback и legacy) выполняется с
PostgreSQL `statement_timeout=3000ms`, включая ожидание блокировок. Настройка
локальна для транзакции и сбрасывается после commit/rollback; поисковый лимит
не распространяется на записи и миграции. Транзакция поиска имеет бюджет
5 секунд. Ожидание/установление соединения в общем Catalog pool ограничено
1 секундой на уровне `pg`, до 2-секундного бюджета получения транзакции Prisma.
При исчерпании пула запрос получает ошибку вместо неограниченного ожидания.

Перед RRF из каждой ветки берётся до `min(5 × limit, 500)` кандидатов, затем
применяется итоговый `limit`. При текущем `limit=20` это до 100 кандидатов
из каждой ветки. Это ограниченное приближение полного RRF, улучшающее полноту
без неограниченного размера объединяемых списков.

При незаданном provider используется GigaChat, в том числе при `NODE_ENV=dev`.
Старое `EMBEDDING_PROVIDER=openai-compatible` трактуется как GigaChat и не
возвращает обращения к старому `EMBEDDING_URL`. Явный `mock` остаётся только
для local/test и запрещён в production. В production также запрещён
`AGENT_MODE=mock`; остальные действующие лимиты перечислены в `.env.example`.

`RECOMMENDATION_SELECTION_PROVIDER=retrieval` сохраняет ранжирование
PostgreSQL; legacy-значение `reranker` означает тот же путь и не вызывает
внешний reranker. Опциональный `factory` по-прежнему передаёт уже найденных
кандидатов в Factory `/api/v1/recommendations/select` с общим service token.
Это не перенос retrieval или владения Benchmark/Test в Factory.

Node должен доверять CA для API/OAuth. Helm values уже передают
`NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt`; проверить наличие
корпоративной цепочки в этом bundle. Отключение TLS verification не требуется.

Для первого создания администратора можно на один запуск задать:

```dotenv
ADMIN_SEED_ENABLED=true
ADMIN_LOGIN=<admin-login>
ADMIN_EMAIL=<admin-email>
ADMIN_PASSWORD=<temporary-strong-password>
```

После успешного создания администратора установить `ADMIN_SEED_ENABLED=false` и перезапустить каталог.

## 4. ENV Frontend

`VITE_*` значения попадают в JS-бандл во время сборки и не должны содержать секреты:

```dotenv
VITE_API_BASE_URL=https://<catalog-api-host>/api
VITE_SOCKET_URL=https://<catalog-api-host>
VITE_S3_DATASETS_URL=<datasets-location>
```

Если frontend и API опубликованы на одном origin, допустимо использовать `VITE_API_BASE_URL=/api`.

## 5. Что делать со старыми данными

Данные Benchmark/Test в старом каталоге хранятся в формате монолита. Текущие
миграции не переносят их в БД Benchmark Service: после разделения источником
Benchmark, Test и DatasetSubsample становится только Benchmark Service.

Для первого развёртывания согласован **чистый bootstrap**:

- старый контур сначала сохранить целиком в backup;
- новую БД Benchmark Service создать пустой;
- если пользователи, диалоги, результаты, аналитика и другие данные каталога
  также не нужны — создать новую пустую БД каталога;
- применить миграции и загрузить утверждённый стартовый набор: **10 Benchmark и
  40 Test**;
- старые БД не удалять до завершения проверки и rollback window.

Не следует считать 40 Test сорока Benchmark: Benchmark — родительская группа,
а Test — отдельная карточка в UI.

### Kafka при чистом bootstrap

Оба consumer читают retained-сообщения с начала топика. Поэтому при полностью
новых БД нельзя оставлять старые сообщения разделения: они могут восстановить
данные предыдущего запуска раньше, чем будет применён стартовый seed.

После остановки старых writers очистить или пересоздать только эти топики:

```text
benchmark-service.commands.v1
benchmark-service.events.v1
benchmark-service.commands.dlq.v1
catalog-service.benchmark-events.dlq.v1
```

Топики рекомендаций из раздела 1 не удалять: это другой бизнес-процесс. Перед
очисткой убедиться, что benchmark-топики не используются другим контуром.

### Если часть данных каталога всё-таки нужна

Не дропать БД каталога целиком: в ней находятся пользователи, модерация,
метрики, результаты, справочники, диалоги, рекомендации и аналитика. В таком
случае нужен отдельный согласованный cleanup/migration старых benchmark-ссылок.
Стандартный seed нельзя запускать поверх смешанного состояния без предварительной
сверки идентификаторов и зависимых таблиц.

Этот runbook дальше описывает согласованный вариант, где данные контура можно
пересоздать. Сначала весь сценарий выполняется на dev. На prod он повторяется
только после приёмки dev.

## 6. Порядок первой раскатки

Перед миграциями сделать backup существующей БД каталога. Миграции разделения удаляют старые исходные таблицы Benchmark/Test из каталога, поэтому простой откат версии приложения не восстанавливает эти таблицы.

1. Остановить старую версию приложения, чтобы она больше не записывала данные.
2. Снять backup старой БД и записать используемые версии приложений.
3. Подготовить чистые benchmark-топики по разделу 5.
4. Создать обе новые БД и отдельные роли для них.
5. В Benchmark Service выполнить:

   ```bash
   npm ci
   npm run build
   npm run db:migrate
   ```

6. В Benchmark Catalog выполнить:

   ```bash
   npm ci
   npm run build
   npm run prisma:migrate:deploy
   ```

7. Запустить Benchmark Service и дождаться readiness.
8. Запустить Benchmark Catalog и дождаться readiness.
9. Загрузить стартовый набор из 10 Benchmark и 40 Test по разделу ниже.
10. Собрать и запустить frontend.
11. Выполнить post-deploy проверку. Старые БД пока оставить доступными только
    для контролируемого отката.

Не использовать `prisma migrate reset` на dev/prod БД.

## 7. Загрузка стартовых 40 Test

Операция нужна только для пустого контура. Скрипт идемпотентен для совпадающих данных и не перезаписывает отличающиеся Test.

Скрипт специально принимает только localhost-адреса. DevOps должен сделать два временных port-forward: каталог на `127.0.0.1:3000`, Benchmark Service на `127.0.0.1:3100`. Затем из репозитория каталога выполнить:

```bash
CATALOG_SEED_URL=http://127.0.0.1:3000/api \
BENCHMARK_SERVICE_SEED_URL=http://127.0.0.1:3100/api/v1 \
CATALOG_SEED_ORIGIN=http://127.0.0.1:5173 \
ADMIN_LOGIN=<admin-login> \
ADMIN_PASSWORD=<admin-password> \
npm run seed:catalog -- --dry-run

CATALOG_SEED_URL=http://127.0.0.1:3000/api \
BENCHMARK_SERVICE_SEED_URL=http://127.0.0.1:3100/api/v1 \
CATALOG_SEED_ORIGIN=http://127.0.0.1:5173 \
ADMIN_LOGIN=<admin-login> \
ADMIN_PASSWORD=<admin-password> \
npm run seed:catalog -- --apply
```

`CATALOG_SEED_ORIGIN` также принимает только локальный HTTP URL. Временно
добавить `http://127.0.0.1:5173` в `TRUSTED_ORIGINS` каталога, сохранив основные
origins; после seed убрать временный origin и перезапустить каталог.
`--dry-run` не проверяет Origin, auth или сеть. Ожидаемый итог исходного Q2 seed:
`10 Benchmarks`, `40 public Tests`, справочники и 9 MetricDefinition.

## 8. Проверка после деплоя

Проверить оба сервиса:

```text
GET <catalog>/api/health/live
GET <catalog>/api/health/ready
GET <benchmark-service>/api/health/live
GET <benchmark-service>/api/health/ready
```

Все четыре запроса должны вернуть HTTP 200. Затем проверить:

- в UI открывается каталог и отображаются 40 карточек Test;
- авторизация работает;
- создание временных Benchmark и Test возвращает `202` и `operationId`;
- операция переходит в `applied`, а объект появляется в каталоге и Benchmark Service;
- в Benchmark Service находятся 10 Benchmark и 40 активных Test;
- публичный каталог показывает те же 40 опубликованных Test без дублей;
- в Kafka/DLQ нет необъяснённых ошибок;
- временные объекты после проверки удалены.

Dev считается принятым только после этой проверки. После такой же проверки prod
можно начать согласованный rollback window, в течение которого старые БД и
backup не удаляются.

## 9. Откат

- Не откатывать схему командой `migrate reset`.
- При ошибке приложения остановить дальнейшую раскатку и сохранить логи, Outbox, Inbox и DLQ.
- Версию приложения можно откатить только после проверки совместимости с уже применённой схемой.
- При чистом bootstrap откат выполняется переключением на сохранённую старую
  версию приложения и её старую БД. Не подключать старое приложение к новой БД.
- Если требуется вернуть удалённые старые таблицы каталога, использовать сделанный перед миграцией backup; автоматической обратной миграции нет.
- Повторно отправлять зависшую пользовательскую операцию вслепую нельзя: сначала проверить её `operationId`, Outbox и результат в Benchmark Service.

## 10. Переход существующего каталога на GigaChat и гибридный поиск

Этот порядок сохраняет уже загруженные Test, их идентификаторы, результаты,
метрики, пользователей, диалоги и задания. Не запускать seed, reset или
очистку Kafka/Redis. Benchmark Service и его БД для смены embeddings не меняются.

1. Сохранить обычный backup Catalog DB и версию образа. В Catalog Vault задать
   четыре `GIGACHAT_*` значения из раздела 3, `EMBEDDING_PROVIDER=gigachat` и
   `RECOMMENDATION_SELECTION_PROVIDER=retrieval`. Удалить явный local
   `EMBEDDING_PROVIDER=mock`, если он попал в deployed-конфигурацию.
   Старые `EMBEDDING_URL/API_KEY/MODEL/SPEC_ID/DIMENSIONS/SOURCE_DIMENSIONS`,
   embedding tuning, `RETRIEVAL_INSTRUCTION` и `RERANKER_*` для нового пути
   не используются; убрать устаревшие записи, чтобы они не вводили в заблуждение.
2. Развернуть новый образ Catalog с обычным `npm run prisma:migrate:deploy`.
   Для этой смены поиска новая миграция не нужна; существующие миграции
   сохраняются. RU/EN FTS строится при запросе по свежим опубликованным
   Catalog-проекциям и справочникам, независимо от наличия embedding documents.
   Это позволяет искать до завершения переиндексации и сразу учитывать
   изменения категорий и таксономии. Исходные сущности не удаляются, старые
   Qwen-векторы не смешиваются с GigaChat spec.
3. В контейнере или Job **этой же версии Catalog** с подключённым Vault config
   выполнить переиндексацию. Например, из `/app`:

   ```sh
   . /vault/secrets/config
   export NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
   npm run search:reindex:prod
   ```

   Она читает опубликованные Test из Catalog-проекций и перестраивает только
   производные search documents. Старые документы другого spec удаляются;
   при ошибке GigaChat индекс может остаться неполным, исходные данные сохраняются.
   Исправить доступ/OAuth/CA и повторить **reindex**, а не seed.
4. Для исходных 40 опубликованных Test ожидать `indexed=40, failed=0` и
   exit code 0; если каталог с тех пор вырос, число должно совпасть с текущим
   числом опубликованных поисковых Test. Проверить `/api/health/ready`, число
   карточек и сохранение ID/результатов. HTTP 200 сам по себе не подтверждает
   исправность OAuth и полноту индекса: отдельно проверить поиск с активным
   GigaChat spec, RU/EN FTS и сценарий временной недоступности embeddings.
   При отстающем индексе readiness остаётся 200 для доступного текстового
   поиска, но сообщает `checks.database.details.searchIndex=degraded` и
   `outOfSync>0`; после успешного reindex ожидать `synchronized` и `outOfSync=0`.

Factory `6b88440` с `CATALOGUE_WORKFLOW=creation` сохраняет conversational
interviewer и Redis-контекст. Его search tool вызывает Catalog
`/api/internal/v1/interviewer/benchmark-tests/search-agent`; embedding-клиент
для этого пути живёт в Catalog. Не менять Factory на legacy workflow ради
смены поиска. `MAS_CONFIG__CATALOGUE_BASE_URL` и
`MAS_CONFIG__CREATOR_BASE_URL` остаются URL Catalog с `/api`, а
`CATALOGUE_API_KEY`/`CREATOR_API_KEY` либо fallback `SERVICE_AUTH_TOKEN`
должны соответствовать `THIRD_PARTY_API_KEY` Catalog. Существующие Redis
настройки, контекст интервью, Inventor и Producer при этом сохраняются.

## 11. Совместимость образов Catalog и Factory для WebSocket

Catalog `0.0.1.108` (`be3301f`, pipeline 4870348) использует историю сообщений
с `history[].id`, а также ответы агента `text` и `recommendations`.
Factory `0.1.0.69` (`8c8c276`, pipeline 4856813) не принимает эти поля/типы
в строгой WS-схеме. Пустой `init` совместим, но возобновление диалога с
сохранённой историей может закрываться с `1003 / invalid_payload`.

Контракт поддерживает Factory `0.1.0.73` (`6b88440`, pipeline 4864402) и его
последующие совместимые версии. При раскатке проверить image tag/digest обеих
Deployment и всех их реплик. Обновление backend не обновляет Factory;
`health=200` и успешное открытие `/ws/interviewer` не подтверждают совместимость
сообщений. Новый Factory сохраняет `CATALOGUE_WORKFLOW=creation`, настройки
подключения Catalog и контекста Redis из раздела 10. Переход на старый workflow
не исправляет несовместимость схемы. Для обновления Factory reset БД,
очистка Redis и удаление истории чатов не требуются.

После обновления открыть существующий диалог с историей, отправить сообщение,
получить ответ, обновить страницу и продолжить тот же диалог. Проверить поиск,
карточки рекомендаций и выбранный сценарий создания. Ожидается отсутствие
цикла `1003` и повторяющегося `attempt=1`. Отдельно подтвердить reindex GigaChat
из раздела 10: совместимость WS не подтверждает готовность поискового индекса.

Catalog прекращает автоматические повторы после WS-кодов 1003/1007/1008 и
показывает ошибку сессии. Сетевые разрывы используют ограниченное число попыток
с увеличением задержки; счётчик сбрасывается после нового валидного сообщения
агента, а не после handshake или pong. События закрытого сокета не меняют новую
сессию того же диалога.
