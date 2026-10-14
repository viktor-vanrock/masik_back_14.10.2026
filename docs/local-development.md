# Локальная работа: Catalog + Kafka + Benchmark Service

Инструкция для разработчика, не инструкция деплоя. nginx, Dev/Prod-конфигурации и сборку deployment-образов она не меняет. Можно использовать уже поднятую локальную инфраструктуру или предоставленные командой локальные адреса.

## 1. Что должно работать

| Компонент | Пример локального адреса | Для чего |
| --- | --- | --- |
| PostgreSQL каталога с pgvector | 127.0.0.1:5432 / benchmark_catalog | Пользовательские данные, результаты, копии Test, поиск |
| PostgreSQL источника | 127.0.0.1:55433 / benchmark_service | Исходные группы и Test |
| Kafka-совместимый брокер | 127.0.0.1:19092 | Команды и события между сервисами |
| Catalog | 127.0.0.1:3000 | Пользовательское API |
| Benchmark Service | 127.0.0.1:3100 | Владелец описаний |
| Frontend | 127.0.0.1:5173 | UI |
| Vault Transit | 127.0.0.1:8200 | Нужен для работы внешних API-ключей |

В текущей локальной обвязке брокер — Redpanda, совместимый с используемым Kafka API. Это не третий бизнес-сервис.

Базы могут находиться на одном компьютере, но **не должны быть одной и той же БД/схемой**. PostgreSQL без pgvector недостаточен для поисковой части каталога.

## 2. Настроить Benchmark Service

В репозитории `benchmark-service`:

```bash
cp .env.example .env
npm ci
npm run db:migrate
npm run start:dev
```

Перед миграцией проверьте DB_URL в .env: он должен указывать на БД источника. Команда db:migrate применяет существующие миграции, не сбрасывает БД.

Основные настройки:

```dotenv
NODE_ENV=development
PORT=3100
DB_URL=postgresql://benchmark_service:benchmark_service@127.0.0.1:55433/benchmark_service?schema=public
BENCHMARK_SERVICE_TOKEN=local-benchmark-service-token-change-me
KAFKA_ENABLED=true
KAFKA_BROKERS=127.0.0.1:19092
KAFKA_CONSUMER_GROUP=benchmark-service-v1
```

Пароль/токен в примере предназначены только для локальной разработки. Сервисный токен — не короче 16 символов. Реальные секреты не коммитьте.

Топики по умолчанию должны совпасть с каталогом:

- benchmark-service.commands.v1.
- benchmark-service.events.v1.
- benchmark-service.commands.dlq.v1.

Без каталога этот сервис можно запустить с KAFKA_ENABLED=false для самостоятельного HTTP-сценария. Для связки с каталогом Kafka включена.

Проверка:

```bash
curl http://127.0.0.1:3100/api/health/live
curl http://127.0.0.1:3100/api/health/ready
curl 'http://127.0.0.1:3100/api/v1/benchmarks?page=1&limit=20'
```

Swagger: `http://127.0.0.1:3100/api/docs`.

## 3. Настроить каталог

В репозитории `benchmark-catalog-back`:

```bash
cp .env.example .env
npm ci
npm run prisma:migrate:deploy
npm run start:dev
```

Перед стартом измените локальный .env, а не production-конфигурации:

```dotenv
NODE_ENV=dev
PORT=3000
DB_URL=postgresql://admin:12345@127.0.0.1:5432/benchmark_catalog?schema=public
JWT_ACCESS_SECRET=replace-with-your-local-secret
JWT_ACCESS_EXPIRE=7d
TRUSTED_ORIGINS=http://127.0.0.1:5173,http://localhost:5173
ORIGIN_TRUST_FORWARDED_HEADERS=false

KAFKA_ENABLED=true
KAFKA_BROKERS=127.0.0.1:19092
KAFKA_CLIENT_ID=benchmark-catalog
KAFKA_CONSUMER_GROUP_ID=benchmark-catalog-projection-v1

AGENT_MODE=mock
EMBEDDING_PROVIDER=mock
EMBEDDING_MODEL=mock-hashed-bow-v1
EMBEDDING_SPEC_ID=mock-hashed-bow-v1:benchmark-test-document-v1:dim-1536:l2
EMBEDDING_DIMENSIONS=1536
EMBEDDING_SOURCE_DIMENSIONS=4096
RERANKER_PROVIDER=mock
RERANKER_MODEL=mock-lexical-reranker-v1
```

Важные различия:

- Каталог использует **NODE_ENV=dev**, источник — **development**. Это не опечатка: у них разные конфигурации.
- Каталогу KAFKA_ENABLED=true нужен при обычном запуске; отключение разрешено в тестовом режиме.
- DB_URL — реальная настройка Prisma/приложения. DATABASE_URL не заменяет её.
- Cookie каталога на локальном HTTP работает в dev-режиме; в других режимах действует Secure-cookie.
- Старые BENCHMARK_SERVICE_READ_MODE/WRITE_MODE в примере окружения не включают монолитный runtime: текущая реализация читает проекции и пишет через Kafka.
- Redis из старых примеров не является заменой Kafka и не хранит исходные Test.

### Первый администратор

Начальная административная учётная запись создаётся только при явно включённом ADMIN_SEED_ENABLED=true. Настройки: ADMIN_LOGIN, ADMIN_EMAIL, ADMIN_PASSWORD. После первоначальной настройки отключите seed.

Это не условие «в dev автоматически создаём админа». Если SuperUser уже есть, seed не должен создавать дубликаты. Возможное восстановление прав существующей настроенной учётной записи — действие bootstrap, поэтому не включайте его без необходимости.

### Vault

Базовые карточки и Kafka-перенос описаний не требуют создания внешнего API-ключа. Но операции с такими ключами требуют доступного Vault Transit и настроенных прав на HMAC.

Настройки: VAULT_ADDR, VAULT_TOKEN или VAULT_TOKEN_FILE, VAULT_TRANSIT_MOUNT, VAULT_TRANSIT_HMAC_KEY. Получите локальный токен из своей существующей обвязки; не копируйте Dev/Prod-секреты в документацию. Подробности реализации — [Vault Transit](vault-transit-api-keys.md).

## 4. Настроить фронтенд

В репозитории `benchmark-catalog-front`:

```bash
npm ci
DEV_PORT=5173 DEV_HOST=127.0.0.1 \
  DEV_PROXY_TARGET=http://127.0.0.1:3000 \
  VITE_API_BASE_URL=/api npm run dev -- --strictPort
```

Vite без явного DEV_PORT использует настройку по умолчанию из своего конфига; здесь порт 5173 задан специально. Прокси `/api` и `/api/socket.io` направлен в каталог, не напрямую в источник.

Откройте `http://127.0.0.1:5173/`. Пользователю не нужно знать адрес Benchmark Service.

## 5. Проверить цепочку

```bash
curl http://127.0.0.1:3000/api/health/live
curl http://127.0.0.1:3000/api/health/ready
curl 'http://127.0.0.1:3000/api/benchmark-tests?page=1&limit=20'
```

Источник может иметь Test, которых нет в публичном каталоге: они ещё не получены, не опубликованы или созданы вне пользовательского сценария каталога.

Для живой проверки связки в каталоге:

```bash
npm run benchmark:topology:smoke
```

Это **изменяющая** проверка: создаёт временную группу/Test с UUID-суффиксом, проходит обновление, отказ дубликата, удаление и восстановление, затем удаляет свои объекты. Нужен локальный SuperUser. Не направляйте её на общий стенд без отдельного разрешения.

Можно настроить CATALOG_SMOKE_URL, BENCHMARK_SERVICE_SMOKE_URL, CATALOG_SMOKE_ORIGIN, CATALOG_SMOKE_TIMEOUT_MS и ADMIN_LOGIN/ADMIN_PASSWORD. По умолчанию — локальные адреса. Проверка требует обе работающие БД, приложения и Kafka; обычные e2e не заменяют её.

## 6. Загрузить исходные 40 Test

Источник данных — `gigametrics_catalogue_q2_green.json` в корне каталога. Это исходные описания, а не автоматически выдуманные карточки.

Набор содержит **10 групп Benchmark и 40 Test**, использующих 9 определений метрик. Скрипт адаптирует классификацию к нынешним родительским связям и capabilities; получается 154 значения справочников. Это характеристики набора, а не обещание точного числа всех строк в вашей БД: там могут быть другие данные.

Сначала проверка без записи:

```bash
npm run seed:catalog -- --dry-run
```

Затем явное применение:

```bash
npm run seed:catalog -- --apply
```

Оба сервиса и Kafka должны быть запущены, нужен локальный SuperUser. В apply скрипт использует API каталога, ждёт подтверждения Kafka и публикует карточки через модерацию. Он **не вставляет исходные Test в БД каталога напрямую**.

Настройки: CATALOG_SEED_URL, BENCHMARK_SERVICE_SEED_URL, CATALOG_SEED_ORIGIN и ADMIN_LOGIN/ADMIN_PASSWORD. Скрипт ограничен loopback HTTP-адресами, чтобы случайно не заполнить удалённый стенд.

Повторное применение сверяет существующие описания и не создаёт ещё 40 копий. Оно не предназначено для автоматического перетирания изменённых карточек. Отклонённую заявку не следует незаметно перепубликовывать через seed.

Скрипт не придумывает численные результаты, Run, human baseline или содержимое полного датасета. Пропущенная исходная статистика адаптируется к обязательному формату, а не выдаётся за измеренную.

## 7. Переиндексация поиска

Если карточки есть, а readiness сообщает об отсутствующем/устаревшем индексе:

```bash
npm run search:reindex
```

Команда использует текущий DB_URL и настройки embedding, читает опубликованные карточки и обновляет поисковые документы. Это изменение индекса, не создание исходных Test. При смене embedding-конфигурации проверьте, что все документы соответствуют новой specId.

## 8. Если не работает

| Симптом | Что проверить |
| --- | --- |
| Не стартует каталог | JWT_ACCESS_SECRET, DB_URL, KAFKA_ENABLED, корректность origins |
| Не стартует источник | DB_URL, токен ≥16 символов, допустимый NODE_ENV |
| Login успешен, следующий запрос 401 | Cookie, один hostname, dev-режим на HTTP |
| Изменение 403 | Origin и роль |
| Операция queued | Outbox и соединение отправителя с брокером |
| Операция processing | Потребитель команд, событие источника, потребитель каталога, DLQ |
| В источнике есть Test, публичный GET 404 | CatalogEntry published, активный Benchmark/Test, доставка копии |
| Readiness каталога 503 | PostgreSQL, pgvector или ошибка чтения поисковых проекций. Отсутствующие/устаревшие эмбеддинги дают HTTP 200 с `details.searchIndex=degraded` и `outOfSync`: текстовый поиск остаётся доступен. |
| API-ключи не создаются | Vault Transit, токен и права HMAC |
| Реальные рекомендации не похожи на ожидаемые | Не остались ли mock-провайдеры; свежая ли embedding-конфигурация |

Нельзя «лечить» эти симптомы сбросом рабочей БД или бездумной сменой consumer group. offsets, Inbox и проекции должны быть согласованы.

**Не запускайте migrate reset на заполненных локальных БД.** Для автотестов используйте отдельные базы: [безопасное тестирование](testing.md).
