# External API keys через Vault Transit

> **Дополнительные технические материалы.** Общую картину текущих двух сервисов и практические ограничения смотрите в [новом руководстве](api-guide.md). Этот файл сохраняет детали отдельного модуля; при противоречии с текущими маршрутами/границами ответственности используйте новое руководство и код.

## Что изменилось

Раньше приложение создавало API key и сохраняло в PostgreSQL его bcrypt-хеш. Теперь исходный API key по-прежнему возвращается только один раз, но вместо bcrypt приложение просит Vault Transit создать HMAC.

В PostgreSQL сохраняются:

- `prefix` — публичная часть ключа для быстрого поиска записи;
- `hmac` — результат операции Vault Transit, например `vault:v1:...`;
- `scopes` — разрешения ключа;
- `status` — `ACTIVE` или `REVOKED`;
- `expires_at` — срок действия;
- `owner` — ID пользователя, который создал ключ;
- служебные метаданные: имя, описание, даты создания и последнего использования.

Полный API key не сохраняется ни в PostgreSQL, ни в Vault.

## Формат ключа

```text
bcb_<16 hex символов prefix>_<43 символа secret>
```

Пример:

```text
bcb_13aef98149a67b2e_EjRjJbV2V7S3Q6vCN4Iq2hxnoH2JH1jGZx2E6-OjRJs
```

Часть `bcb_13aef98149a67b2e` хранится в поле `prefix`. Она не является секретом. Остальная часть делает ключ непредсказуемым.

## Создание ключа

1. Администратор вызывает `POST /external-api/api-keys`.
2. Backend генерирует случайный API key.
3. Backend кодирует полный ключ в Base64.
4. Backend вызывает:

```text
POST /v1/<mount>/hmac/<key-name>/sha2-256
```

5. Vault возвращает HMAC.
6. Backend сохраняет prefix, HMAC и метаданные в БД.
7. Backend возвращает исходный API key в HTTP-ответе только один раз.

Пример тела запроса:

```json
{
  "name": "benchmark-agent-prod",
  "scopes": ["benchmark-tests:read"],
  "expiresAt": "2027-01-01T00:00:00.000Z"
}
```

## Проверка запроса

Клиент передаёт ключ одним из способов:

```http
X-API-Key: bcb_...
```

или:

```http
Authorization: Bearer bcb_...
```

Также поддерживается `Authorization: ApiKey bcb_...`.

Backend выполняет следующие шаги:

1. Проверяет формат ключа и извлекает prefix.
2. Находит запись по prefix.
3. Проверяет `status` и `expires_at`.
4. Кодирует полученный ключ в Base64.
5. Вызывает:

```text
POST /v1/<mount>/verify/<key-name>/sha2-256
```

с полями `input` и `hmac`.
6. При `valid: true` проверяет обязательные scopes endpoint-а.
7. Обновляет `last_used_at` и разрешает запрос.

Если Vault недоступен, запрос отклоняется с `503`. Это fail-closed поведение: нельзя обходить криптографическую проверку из-за сбоя инфраструктуры.

## Настройка Vault

Пример для администратора Vault:

```bash
vault secrets enable transit

vault write transit/keys/benchmark-catalog-external-api \
  type=hmac \
  exportable=false \
  allow_plaintext_backup=false
```

Пример минимальной policy приложения:

```hcl
path "transit/hmac/benchmark-catalog-external-api/sha2-256" {
  capabilities = ["update"]
}

path "transit/verify/benchmark-catalog-external-api/sha2-256" {
  capabilities = ["update"]
}
```

Приложению не нужны права на чтение, экспорт, backup, удаление или изменение
Transit key.

## Переменные окружения

```dotenv
VAULT_ADDR=https://vault.example.internal
VAULT_TOKEN_FILE=/vault/secrets/token
VAULT_NAMESPACE=
VAULT_TRANSIT_MOUNT=transit
VAULT_TRANSIT_HMAC_KEY=benchmark-catalog-external-api
VAULT_TIMEOUT_MS=3000
```

Для локальной разработки можно временно использовать `VAULT_TOKEN`, но в Kubernetes включён `vault.hashicorp.com/agent-inject-token: 'true'`, поэтому Vault Agent записывает обновляемый токен в `/vault/secrets/token`.

Для внутреннего TLS-сертификата можно настроить стандартную переменную Node.js `NODE_EXTRA_CA_CERTS`.

## Что будет со старыми ключами

Старые записи содержат bcrypt-хеш, а исходные ключи нигде не сохранены. Получить исходный ключ из bcrypt-хеша нельзя, поэтому автоматически создать для него Vault HMAC невозможно.

Миграция:

- удаляет колонку `key_hash`;
- добавляет `hmac`, `scopes`, `status`, `owner`;
- переводит все существующие ключи в `REVOKED`.

После выкладки старые интеграционные ключи нужно выпустить заново и передать интеграциям по защищённому каналу.

## Где находится код

- `src/vault/vault-transit.service.ts` — HTTP-клиент Vault Transit;
- `src/external-api/api-keys/external-api-keys.service.ts` — создание и проверка ключей;
- `src/external-api/api-keys/guards/external-api-key.guard.ts` — извлечение ключа из заголовков;
- `src/external-api/api-keys/decorators/external-api-scopes.decorator.ts` — scopes endpoint-а;
- `prisma/models/external-api.prisma` — модель БД;
- `prisma/migrations/20260701113000_external_api_keys_vault_transit/migration.sql` — миграция.
