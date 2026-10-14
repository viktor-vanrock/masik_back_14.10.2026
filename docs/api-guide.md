# API каталога: ориентиры и примеры

Актуальность: 16.09.2026. Все пути ниже начинаются с `/api`. Локальная база адреса: `http://127.0.0.1:3000/api`. Swagger находится по этому же адресу.

Это руководство объясняет основные маршруты и смысл запросов. Полный набор DTO и конкретный формат карточки смотрите в Swagger и контроллерах: их не следует заменять догадками по названиям таблиц.

## 1. Три разных способа доступа

| Клиент | Авторизация | Для чего |
| --- | --- | --- |
| UI, внутренний Postman/curl | JWT в HttpOnly cookie `access_token` | Вход, личные заявки, административные действия |
| Внешняя система → API каталога | `x-api-key` со scopes | Получение карточек, метрик, моделей и работа с результатами |
| Другой клиент → Benchmark Service | `x-benchmark-service-token` для записи | Самостоятельное управление исходными описаниями |

Последняя строка — API **другого сервиса**, `/api/v1` на порту 3100. Это не токен пользователя и не API-ключ каталога.

Для внутренних маршрутов Bearer JWT вместо cookie не является поддерживаемым способом входа. У внешнего API заголовок Authorization может содержать API-ключ, не пользовательский JWT.

Роли: `USER`, `ADMIN`, `SUPERUSER`. В таблицах ниже «админ» означает ADMIN или SUPERUSER; «SuperUser» — только SUPERUSER.

## 2. Вход и Origin

`POST /auth/login` принимает:

```json
{
  "username": "your-local-user",
  "password": "your-local-password"
}
```

Успешный ответ: HTTP 200, `{"success":true}` и Set-Cookie. Postman должен сохранить cookie и отправлять её в следующих запросах.

Для изменяющих внутренних запросов нужен допустимый `Origin`, например `http://127.0.0.1:5173` при соответствующей локальной настройке. Это относится и к login/register/logout, несмотря на отсутствие требования предварительного входа. Referer может использоваться как запасной источник origin.

Пример с curl (пароль замените локальным, файл cookie не публикуйте):

```bash
curl -i -c /tmp/catalog-doc-session.cookies \
  -H 'Origin: http://127.0.0.1:5173' \
  -H 'Content-Type: application/json' \
  -d '{"username":"your-local-user","password":"your-local-password"}' \
  http://127.0.0.1:3000/api/auth/login
```

Для последующих запросов добавляйте `-b /tmp/catalog-doc-session.cookies`. Если сначала вошли через localhost, а затем обращаетесь к 127.0.0.1, cookie может не подойти: используйте один hostname.

`POST /auth/register`: username, email, сильный password; ответ 201 и cookie. `POST /auth/logout`: 200, очищает cookie. Logout не отзывает уже скопированный stateless JWT до истечения его срока.

### Профиль и управление пользователями

GET `/users/profile` возвращает профиль текущего пользователя после входа. POST/GET `/users`, GET/PATCH/DELETE `/users/{id}` доступны только SuperUser. Создание принимает username, email, сильный password и необязательную role. Обычная регистрация не позволяет назначить себе административную роль.

## 3. Публичное чтение

| Метод и путь | Смысл |
| --- | --- |
| GET `/catalog` | Test, сгруппированные по Benchmark |
| GET `/benchmarks` | Активные группы Benchmark |
| GET `/benchmarks/options` | Варианты групп для выбора |
| GET `/benchmarks/{id}` | Активная группа |
| GET `/benchmark-tests` | Опубликованные активные карточки |
| GET `/benchmark-tests/filters/options` | Значения для фильтров |
| GET `/benchmark-tests/{id}` | Одна публичная карточка |
| GET `/catalog/settings` | Все активные справочники в объединённом формате |
| GET `/metrics/models` | Модели |
| GET `/metrics/tests/{testId}/results` | История результатов публичного Test |

Скрытая карточка даёт 404. Активная группа сама по себе не означает, что все её Test опубликованы.

Обычные списки карточек/групп/результатов используют ответ `{data: [...], total: N}`. У `/catalog` элемент data — группа с `benchmark` и `tests`, а не плоская карточка.

### Пагинация и фильтры

Для карточек: `page` от 1, `limit` от 1, `search`, `sortDirection=asc|desc`. Общий PaginationDto по умолчанию имеет page=1 и limit=1000; для живых клиентов лучше задавать разумный limit явно.

Сортировка карточек: `createdAt`, `name`, `sizeInSamples`, `difficulty`, `language`.

UUID-фильтры:

- suiteIds, macroGroupIds, subGroupIds, abilityTaxonIds.
- domainIds, subdomainIds, languageIds, difficultyIds.
- taskTypeIds, modalityIds, capabilityIds.

Массивы UUID можно передать повторяющимися параметрами или через запятую. Текстовые skills/abilityTags лучше передавать повторяющимися параметрами. Размеры: `sizeMin`, `sizeMax`, неотрицательные значения.

Пример:

```text
GET /api/benchmark-tests?page=1&limit=20&search=math&sortColumn=name&sortDirection=asc
GET /api/benchmark-tests?suiteIds=UUID1&suiteIds=UUID2
```

Не все списки используют полный набор фильтров Test. Источник Benchmark Service имеет собственный более узкий QueryDto.

## 4. Изменения Benchmark/Test: сначала 202, потом итог

| Метод и путь | Доступ | Успешная постановка |
| --- | --- | --- |
| POST `/benchmarks` | Админ | 202 |
| PATCH `/benchmarks/{id}` | Админ | 202 |
| DELETE `/benchmarks/{id}` | SuperUser | 202 |
| POST `/benchmarks/{id}/restore` | Админ | 202 |
| POST `/benchmark-tests` | Админ | 202 |
| PATCH `/benchmark-tests/{id}` | Админ | 202 |
| DELETE `/benchmark-tests/{id}` | SuperUser | 202 |
| POST `/benchmark-tests/{id}/restore` | Админ | 202 |

Локальная проверка может вернуть 400/404/409 ещё до постановки. После 202 источник тоже может отклонить команду.

Создание группы:

```json
{
  "name": "Локальная проверка — уникальный суффикс",
  "nameEn": "Local check — unique suffix",
  "description": "Временная группа для проверки API"
}
```

Пример ответа:

```json
{
  "operationId": "52da7b7a-5b8b-4ccf-a32c-1549f8c70c50",
  "aggregateId": "4442ee17-dd60-43f0-9421-ccceba3b1d13",
  "aggregateType": "benchmark",
  "status": "queued",
  "statusUrl": "/api/benchmark-operations/52da7b7a-5b8b-4ccf-a32c-1549f8c70c50"
}
```

**aggregateId — ID создаваемой группы/Test, operationId — ID команды.** Для следующего изменения нужен aggregateId, для проверки завершения — operationId.

`GET /benchmark-operations/{operationId}` возвращает объект с `commandEventId`, `commandEventType`, `aggregateId`, `aggregateType`, временными полями и status:

| status | Значение |
| --- | --- |
| queued | Команда ещё не отмечена отправленной в Kafka |
| processing | Отмечена отправка; итоговое событие ещё не применено каталогом |
| applied | Источник подтвердил, копия и итог операции сохранены каталогом |
| rejected | Бизнес-отказ; смотрите reasonCode, message, statusCode, при наличии deletedId |

Regular User читает свои операции; админ — любые. Чужая операция для обычного пользователя даёт 404.

HTTP 200 самого запроса статуса не означает успешную команду: нужно проверить `status === "applied"`. Для `rejected` HTTP-эквивалент причины находится внутри `statusCode`.

## 5. Форма Test в каталоге

Минимальный черновик:

```json
{
  "suiteId": "4442ee17-dd60-43f0-9421-ccceba3b1d13",
  "name": "Проверка точных ответов — уникальный суффикс",
  "nameEn": "Exact answers — unique suffix",
  "description": "Модель должна ответить на короткий вопрос заданным значением.",
  "evaluationLogic": "Сравнить ответ с эталоном.",
  "metrics": ["ExactMatch"],
  "examples": [
    {"input": "Сколько будет 2 + 2?", "output": "4"}
  ]
}
```

ID в примере условный: замените его активной группой из своего ответа. `metrics` — **имена**, не UUID. Каталог использует существующие определения по имени; если имени ещё нет, текущая реализация создаёт определение с настройками по умолчанию primary / higher_is_better. Поэтому опечатка в имени может создать лишнюю Metric. Для метрик со специальной шкалой сначала создайте корректное определение через `/metrics`.

Внутри источника сохраняется `metricIds`. При записи результата уже нужен UUID Metric, а не её имя.

Дополнительные блоки формы:

| Блок | Поля |
| --- | --- |
| Описание | descriptionEn, shortDescription, taskDescription, instructions, instructionsEn |
| Классификация | macroGroupId, subGroupIds, abilityTaxonIds, taskTypeId, modalityIds, languageId, difficultyId, capabilityIds, domainIds, subdomainIds |
| Свободные метки | skills, abilityTags |
| Размеры | sizeInSamples, medianSampleSizeWords, requestLengthDist, responseLengthDist |
| Материалы | codebase, examples, references, links, datasetSubsamples |
| Проверка | evaluationLogic, humanBaseline, humanBaselineNotes, recommendedMetricsDescription, requiredGigaChatQualityLevel |
| GigaMetrics | gigaMetricAdapterName, gigaMetricSetUrl, gigaMetricLaunchCommand, gigaMetricsCodebaseUrl |
| Дополнительные сведения | confidenceScore, confidentialityLevel, knowledgeLevel, importance, importanceComment, contextFieldFormat, answerFieldFormat |
| Происхождение | isGenerated, jiraTicketId |

Распределение длины: `{"min":1,"median":5,"max":10}`, целые неотрицательные числа, min ≤ median ≤ max.

Пример части данных:

```json
{
  "name": "Проверочные примеры",
  "nameEn": "Validation examples",
  "split": "validation",
  "sizeInSamples": 100,
  "examples": [
    {"input": "Вопрос", "output": "Эталон", "explanation": "Пояснение"}
  ]
}
```

На создании ID части генерирует каталог. На обновлении верните прежний ID, чтобы сохранить идентичность. Самостоятельный HTTP API источника устроен иначе: там ID части обязателен в полном описании.

PATCH каталога **частичный**: `{"description":"Новое описание"}` сохраняет все неуказанные поля. Переданный массив заменяет прежний целиком.

Не передавайте `validationStatus`, авторство, собственную классификацию DatasetSubsample, старые субдатасетные имена или поля Run.

## 6. Заявки и модерация

| Метод и путь | Доступ |
| --- | --- |
| POST `/catalog/submissions` | Вошедший пользователь; форма Test + необязательный sourceConversationId; 202 |
| GET `/catalog/submissions/mine` | Свои заявки; page/limit/search/status |
| GET `/catalog/submissions/{testId}` | Собственная активная заявка |
| POST `/catalog/submissions/{testId}/restore` | Автор собственной заявки; 202 |
| GET `/benchmark-tests/management` | Админ, без публичного ограничения published |
| GET `/benchmark-tests/management/{id}` | Админ |
| PATCH `/catalog/entries/{testId}/moderation` | Админ; 200 |

Публикация:

```json
{"status": "published"}
```

Отклонение:

```json
{"status": "rejected", "rejectionReason": "Нужны понятные инструкции и пример ответа"}
```

Для публикации нужна назначенная Metric. Через этот маршрут нельзя произвольно назначить автора или менять спецификацию Test.

## 7. Справочники

Общий публичный GET `/catalog/settings` возвращает три раздела: `taxonomy`, `parameters`, `domains`.

Маршруты отдельных справочников:

```text
/catalog/settings/taxonomy/macro-groups
/catalog/settings/taxonomy/sub-groups
/catalog/settings/taxonomy/ability-taxons
/catalog/settings/parameters/task-types
/catalog/settings/parameters/modalities
/catalog/settings/parameters/languages
/catalog/settings/parameters/difficulties
/catalog/settings/parameters/capabilities
/catalog/settings/domains/domains
/catalog/settings/domains/subdomains
```

Для каждого доступны GET списка / GET по ID после входа; POST/PATCH/DELETE — админу. DELETE 204 — мягкое удаление, использованные значения защищены.

Корневые значения имеют name/nameEn. Создание SubGroup требует macroGroupId; Subdomain — domainId. В объединённом GET родитель так и называется, а в ответах отдельных административных списков дочерних значений используется `parentId`. Не перепутайте форматы при импорте.

## 8. Метрики, модели, результаты

| Метод и путь | Доступ |
| --- | --- |
| POST `/metrics`, GET `/metrics`, GET `/metrics/{id}` | Вошедший пользователь |
| GET `/metrics/lookups/priorities`, `/directions` | Вошедший пользователь |
| PATCH/DELETE `/metrics/{id}` | Админ |
| POST `/metrics/models` | Вошедший пользователь |
| POST `/metrics/results` | Вошедший пользователь |
| GET `/metrics/models`, GET `/metrics/tests/{testId}/results` | Публично, результаты только опубликованного активного Test |

Metric: name, необязательный displayName, обязательные UUID priorityId/directionId из lookups, необязательные minValue/maxValue/targetValue/metadata. Проверяется minValue ≤ maxValue. Текущий API не превращает targetValue в автоматический порог приёмки результата.

Model:

```json
{"id":"local-check-model","name":"Модель для локальной проверки","provider":"local","isOpenSource":false}
```

Результат:

```json
{
  "testId": "UUID вашего Test",
  "metricId": "UUID назначенной Metric",
  "modelId": "local-check-model",
  "value": 0.75,
  "rawValue": "75%",
  "obtainedAt": "2026-09-16T09:00:00.000Z",
  "importSource": "manual-local-check"
}
```

Поля с текстом «UUID вашего…» здесь обозначают подстановку, а не буквально валидное значение. Test должен иметь активную копию и активную группу; запись результата не требует, чтобы CatalogEntry уже был published. **Публичное чтение** результата требует published.

Metric обязана быть назначена Test, Model — существовать. Число должно быть конечным и помещаться в формат БД. Текущая запись результата не проверяет value на попадание между minValue/maxValue: эти настройки не следует принимать за универсальную автоматическую валидацию качества.

API результатов возвращает страницу истории записей; поле scores карточки представляет последние значения по Model–Metric. Непустые runId/subsetId/subsampleId отвергаются.

Первый результат делает Test неизменяемым. Не проверяйте этот сценарий на стартовых карточках, если потом хотите их редактировать.

## 9. Внешнее API каталога

Ключ создаёт администратор через `POST /external-api/api-keys`. Доступны список ключей, список scopes `GET /external-api/api-keys/scopes` и отзыв через DELETE по ID. Отзыв не является удалением истории.

Открытый ключ выдаётся только при создании. В БД сохраняется HMAC и префикс, а не исходный секрет; вычисление HMAC требует Vault Transit. Ключ храните как пароль.

| Scope | Маршруты / действия |
| --- | --- |
| benchmark-tests:read | POST `/external/v1/benchmark-tests/search`, GET `/fields`, GET `/fields/{field}/values`, GET `/{id}` |
| metric-definitions:read | GET `/external/v1/metrics`, GET по ID и lookups |
| metric-definitions:write | POST `/external/v1/metrics` |
| models:read / models:write | GET / POST `/external/v1/models` |
| metric-results:read | GET `/external/v1/benchmark-tests/{testId}/metric-results` |
| metric-results:write | POST `/external/v1/metric-results` |

По умолчанию ключ имеет только benchmark-tests:read. Права записи нужно назначить явно. Эти маршруты не требуют cookie/Origin, но **обязательно требуют действующий API-ключ и scope**. Декоратор Public в коде означает обход пользовательского JWT, не отсутствие защиты.

Внешний POST search — фильтрация карточек по структурированным полям, не запуск интервьюера. Используйте `fields` и DTO внешнего API; его формат отличается от внутренней формы создания.

## 10. Диалоги, Socket.IO, аналитика

HTTP GET `/conversations` и `/conversations/{id}` требуют входа и возвращают только диалоги текущего пользователя, включая роли ADMIN и SUPERUSER. Запрос чужого диалога по ID возвращает 404.

Диалоговые команды отправляются по Socket.IO с path `/api/socket.io`. Это **не обычный REST** и не raw WebSocket: клиент должен поддерживать протокол Socket.IO. Авторизация — cookie и допустимый origin.

Описание событий и процессов: [рекомендации и интервьюер](recommendations-and-interviewer.md).

Аналитика:

- POST `/analytics/benchmark-views`, `/analytics/catalog-events` — публичные события с проверкой DTO/Origin для изменяющих HTTP-запросов.
- GET `/analytics/overview`, `/benchmarks/views`, `/benchmark-tests/views`, `/events` — админ.

## 11. Ошибки и проверка в Postman

| Код / симптом | Сначала проверьте |
| --- | --- |
| 400 UUID expected | Подставился ли действительный aggregateId, а не пустая переменная или operationId |
| 400 входные данные | UUID справочников, URL, распределение длин, forbidden поля |
| 401 | Есть ли правильная cookie или внешний ключ / токен нужного сервиса |
| 403 | Роль, Origin, scope; не путайте три способа авторизации |
| 404 карточки | Публикация, удаление Test/Benchmark, полнота копии, права автора |
| 409 | Дубликат, результаты на Test, занятый справочник, незавершённая команда |
| 202, но карточки нет | Проверьте operationId до applied; затем отдельно проверьте модерацию |
| Статус processing долго | Outbox, потребители Kafka, failures/DLQ обоих сервисов |

Коллекции находятся в `postman/`. Используйте коллекцию checkpoint вместе с local environment; внешний набор — отдельно с API-ключом. Lifecycle-запросы выполняйте по порядку, имя на новый прогон делайте уникальным. Коллекция для checkpoint — вспомогательная проверка, не полный паспорт всех маршрутов.
