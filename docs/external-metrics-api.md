# External Metrics API

> **Дополнительные технические материалы.** Общую картину текущих двух сервисов и практические ограничения смотрите в [новом руководстве](api-guide.md). Этот файл сохраняет детали отдельного модуля; при противоречии с текущими маршрутами/границами ответственности используйте новое руководство и код.

The external metrics API is protected by the same Vault Transit-backed API keys
as the external benchmark-test API.

## Available scopes

| Scope | Access |
| --- | --- |
| `benchmark-tests:read` | Find benchmark tests and their existing metric ids. |
| `metric-definitions:read` | Read metric definitions and metric lookup dictionaries. |
| `metric-definitions:write` | Create metric definitions. |
| `models:read` | Read registered models. |
| `models:write` | Create or update a model by its external id. |
| `metric-results:read` | Read metric results by benchmark test id. |
| `metric-results:write` | Create metric results. |

A typical result-upload integration should receive:

```json
{
  "scopes": [
    "benchmark-tests:read",
    "metric-definitions:read",
    "models:write",
    "metric-results:write"
  ]
}
```

Add `metric-definitions:write` only when the external team is also allowed to
create new metric definitions. Add read scopes for models/results only when the
integration needs those responses.

## Endpoints

### Metric definitions

```text
GET  /api/external/v1/metrics
GET  /api/external/v1/metrics/:id
GET  /api/external/v1/metrics/lookups/priorities
GET  /api/external/v1/metrics/lookups/directions
POST /api/external/v1/metrics
```

### Models

```text
GET  /api/external/v1/models
POST /api/external/v1/models
```

`POST /models` is an upsert by the string `id`. Repeating the request updates
name/provider/open-source metadata.

### Metric results

```text
GET  /api/external/v1/benchmark-tests/:testId/metric-results
POST /api/external/v1/metric-results
```

A metric result requires an existing benchmark test, metric definition and
model. The existing service also validates that `subsetId`, when supplied,
belongs to the selected test.

## Issue an API key

Authenticate as an internal ADMIN or SUPERUSER, then call:

```http
POST /api/external-api/api-keys
Authorization: Bearer <admin-jwt>
Content-Type: application/json
```

Example for a team that uploads results and may create metric definitions:

```json
{
  "name": "external-metrics-team-dev",
  "description": "External team metric upload integration",
  "scopes": [
    "benchmark-tests:read",
    "metric-definitions:read",
    "metric-definitions:write",
    "models:read",
    "models:write",
    "metric-results:read",
    "metric-results:write"
  ],
  "expiresAt": "2027-01-01T00:00:00.000Z"
}
```

The `apiKey` field is returned once. Send it to the external team through an
approved secret-sharing channel. Do not send the Vault token or admin JWT.

The external team sends the key as:

```http
X-API-Key: bcb_...
```

## Suggested upload flow

1. Search benchmark tests and save the selected `testId`.
2. Read metric definitions or create a new one when permitted.
3. Upsert the external model.
4. Create the metric result.
5. Optionally read results by test to verify ingestion.

## Postman

Import the collection and environment from `postman/`:

- `benchmark-catalog-external-metrics.postman_collection.json`
- `benchmark-catalog-external-metrics-local.postman_environment.json`

Run the collection in order. It creates temporary API keys, a test metric
and a metric result. Cleanup deletes the temporary metric through the internal
admin endpoint, which also removes its test result through the existing cascade,
and revokes the temporary API keys. The test model uses a stable id and is
upserted rather than duplicated.
