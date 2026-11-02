# План выделения Benchmark Service

> **Исторический документ.** Содержимое ниже фиксирует прежний этап/план и может описывать монолит, переходные таблицы, будущий Run или уже неактуальные команды. Для работы после разделения используйте [актуальную архитектуру](architecture.md), [локальный запуск](local-development.md) и [тестирование](testing.md). Не воспринимайте этот файл как текущий контракт.

**Статус:** выполняется по strangler-подходу без одновременного big bang

## Уже зафиксировано

- Канонические Benchmark/Test/DatasetSubsample и бизнес-инварианты описаны в
  [доменном контракте](benchmark-domain-contract.md).
- Публичные и management HTTP-контракты защищены e2e-тестами.
- Benchmark и Test теперь принадлежат отдельной Nest-границе
  `BenchmarkServiceModule`; Catalog оставляет у себя listing, submission,
  moderation, search и recommendations.
- Recommendations импортируют search capability напрямую и больше не используют
  весь `CatalogModule` как service locator.

Маршруты и frontend-контракт на этом шаге не меняются. Это намеренно: сначала
появляется проверяемый внутренний шов, затем локальный адаптер заменяется HTTP
адаптером.

## Принятое транспортное решение

Целевая рабочая интеграция Catalog ↔ Benchmark Service асинхронная: Kafka,
локальные Outbox/Inbox, идемпотентные consumers, retry с backoff и DLQ. Catalog
обслуживает чтения из своей проекции и поэтому не зависит от доступности
Benchmark Service на каждом пользовательском запросе.

Benchmark Service при этом имеет собственный versioned HTTP API и может
использоваться отдельно от Catalog другими проектами. Подробные гарантии,
владение данными и saga описаны в
[архитектуре интеграции](benchmark-service-integration-architecture.md).

## Переходная зависимость

Файлы Benchmark/Test физически пока находятся под `src/catalog`, а локальный
Benchmark implementation ещё вызывает индексацию Catalog и читает
`CatalogEntry` для legacy visibility. Это известная обратная зависимость, а не
целевая архитектура.

Разрывать её следует в таком порядке:

1. Выделить versioned DTO/contract package без Prisma типов.
2. Разделить `BenchmarkTestService` на specification commands/queries и Catalog
   projection orchestration.
3. Убрать `CatalogEntry`, moderation status и search indexing из Benchmark
   transaction. После изменения Test публиковать versioned domain event/outbox.
4. В Catalog хранить ссылку `benchmarkId + testId + testVersion` и собственную
   read projection/snapshot для списка, поиска и модерации.
5. Провести команды через локальный Outbox/Inbox и только затем перенести
   consumer в отдельный процесс Benchmark Service.
6. Запустить reusable contract suite сначала против HTTP API монолита, затем
   против HTTP API нового сервиса; Kafka-контракты проверять отдельным suite.
7. Проверить duplicate/out-of-order/retry/DLQ и чтение при недоступных Kafka и
   Benchmark Service.
8. Только после reconciliation удалить локальные Prisma-модели Benchmark/Test
   из Catalog.

## Целевая зависимость

```text
Frontend
  -> Benchmark Catalog API
       -> CatalogEntry / moderation / search / recommendations
       -> local Benchmark projection
       -> Outbox -> Kafka commands

Kafka events
  -> Catalog Inbox -> projection

Benchmark Service API
  -> Benchmark / TestVersion / DatasetSubsample / taxonomy / metricId links

Benchmark Service Kafka consumer
  -> Inbox -> Benchmark DB -> Outbox -> Kafka events
```

Benchmark Service не принимает catalog status, reviewer или rejection reason.
Catalog не изменяет specification напрямую в своей БД, не строит межсервисный
join и не требует синхронного ответа Benchmark Service во время
пользовательского запроса.
