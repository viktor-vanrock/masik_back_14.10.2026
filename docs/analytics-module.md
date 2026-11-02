# Analytics module

> **Дополнительные технические материалы.** Общую картину текущих двух сервисов и практические ограничения смотрите в [новом руководстве](api-guide.md). Этот файл сохраняет детали отдельного модуля; при противоречии с текущими маршрутами/границами ответственности используйте новое руководство и код.

Модуль добавляет базовую аналитику для будущего admin dashboard.

## Что уже собираем

- `benchmark_view` — просмотр benchmark suite.
- `benchmark_test_view` — просмотр конкретной benchmark card / BenchmarkTest.
- `catalog_search` — использование поиска в каталоге.
- `filter_usage` — использование фильтров в каталоге.

Сырые события лежат в таблице `analytics_events`. Для приватности IP и frontend `sessionId` сохраняются только в виде sha256-хэша. Соль можно переопределить через `ANALYTICS_HASH_SALT`.

## Public tracking endpoints

### Track benchmark view

```http
POST /analytics/benchmark-views
Content-Type: application/json
```

```json
{
  "benchmarkId": "6d338b8f-4f4a-438f-a111-7be8f859e20e",
  "benchmarkTestId": "postman-mmlu-ru-math-123",
  "sessionId": "anonymous-browser-session-id",
  "metadata": {
    "source": "benchmark-card",
    "page": "catalog"
  }
}
```

Если `benchmarkTestId` не передан, будет записан `benchmark_view`. Если передан — `benchmark_test_view`.

### Track catalog search/filter usage

```http
POST /analytics/catalog-events
Content-Type: application/json
```

```json
{
  "type": "catalog_search",
  "search": "math reasoning",
  "sessionId": "anonymous-browser-session-id",
  "metadata": {
    "page": "catalog"
  }
}
```

```json
{
  "type": "filter_usage",
  "filters": {
    "domains": ["Math"],
    "language": ["ru"],
    "difficulty": ["expert"]
  },
  "sessionId": "anonymous-browser-session-id"
}
```

## Admin dashboard endpoints

Все endpoints ниже требуют `ADMIN` или `SUPERUSER`.

### Overview

```http
GET /analytics/overview?from=2026-07-01&to=2026-07-10
```

Возвращает:

- total events;
- total views;
- views по suite и test;
- searches;
- filter usage;
- unique sessions;
- top benchmarks;
- top benchmark tests;
- daily time series.

### Top benchmark suites by views

```http
GET /analytics/benchmarks/views?from=2026-07-01&to=2026-07-10&limit=10
```

### Top benchmark tests by views

```http
GET /analytics/benchmark-tests/views?from=2026-07-01&to=2026-07-10&limit=10
```

### Raw events

```http
GET /analytics/events?type=benchmark_view&page=1&limit=50
```

Подходит для debug-таблицы в админке.

## Что можно добавить следующим шагом

- CTR по карточкам: impressions + clicks/views.
- Популярные поисковые запросы и запросы без результатов.
- Популярные фильтры и комбинации фильтров.
- Retention/возвраты по anonymous session.
- Метрики admin activity: создание/редактирование/удаление benchmark/test.
- Conversion funnel: catalog open → benchmark card open → docs/github/dataset click.
