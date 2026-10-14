# Ручная проверка бизнес-чекпоинта

> **Исторический документ.** Содержимое ниже фиксирует прежний этап/план и может описывать монолит, переходные таблицы, будущий Run или уже неактуальные команды. Для работы после разделения используйте [актуальную архитектуру](architecture.md), [локальный запуск](local-development.md) и [тестирование](testing.md). Не воспринимайте этот файл как текущий контракт.

Этот чек-лист фиксирует состояние проекта **до выделения Benchmark Service**.
Он нужен для проверки текущего backend-контракта живыми запросами и основных
пользовательских сценариев во frontend.

> Postman-коллекция создаёт реальные `Benchmark`, `Test`, `Metric`, `Model`,
> `MetricResult` и пользователя с уникальным префиксом `postman_*`. Запускайте
> её только на локальной или одноразовой dev-БД, не на production.

## Что было и что стало

| Область | Раньше | Теперь | Где смотреть |
| --- | --- | --- | --- |
| Термины | Benchmark, Test и Dataset смешивались | `Benchmark` — группа; `Test` — тест внутри группы; `DatasetSubsample` — часть Test для описания/визуализации | Каталог `/`, карточка `/benchmark/:id`, admin `/admin` |
| Модерация | Статус дублировался в Test и каталоге | Статусом владеет только `CatalogEntry`; Test API не принимает `validationStatus` | Admin → «Валидация», Profile → «Мои бенчмарки» |
| Видимость | Непубликованные записи могли попадать в общие чтения | Public API/каталог показывают только `published`; admin management видит `validation/rejected/published` | `/`, `/admin`, Postman folder `02`/`04` |
| Metric | Test-поля частично жили на Metric | Metric хранит только глобальное определение; evaluation logic, required quality и GigaMetrics adapter принадлежат Test | Admin edit Test и Postman folder `01`/`02` |
| Test–Metric | Публикация и изменение связей были недостаточно защищены | Для публикации обязательна хотя бы одна Metric; опубликованный Test нельзя оставить без Metric | Postman folder `02` |
| Результаты | В контракте оставались следы Run/subsample scope | `MetricResult` относится только к Test; `runId`, `subsetId`, `subsampleId` отклоняются | Карточка → «Результаты», Postman folder `03` |
| Несколько Metric | Было неясно, нужен ли общий score | Каждая Metric и её результат отображаются отдельно; общего score нет | Карточка → «Результаты» |
| Human baseline | Мог моделироваться как `Model=Human` | Human baseline — поле Test; synthetic Human result запрещён | Карточка → «Результаты», Postman folder `03` |
| История | Спецификацию можно было испортить после появления результатов | После первого MetricResult спецификация и удаление Test заблокированы до появления версионирования | Postman folder `03` |
| Удаление | Связанные сущности могли терять историю | Нельзя удалить Benchmark с активными Test и Metric, назначенную Test/имеющую историю; soft-delete/restore Test проверены | Postman folder `02`/`03`/`05` |
| Будущее выделение | Не было надёжной границы интеграции | Изменения Benchmark/Test пишут versioned snapshot/delete events в Transactional Outbox; Kafka пока можно держать выключенной | таблица `outbox_messages`, e2e `benchmark-outbox`/`catalog-benchmark-projection` |

`Run` в текущем чекпоинте **не реализован** и не должен появляться ни в UI, ни в
API, ни в БД. Его будем проектировать отдельно.

## 1. Запуск локального стенда

### Backend

```bash
cd /Users/keofoxy/Development/SberDevices/benchmark-catalog/benchmark-catalog-back
npm install
npm run docker:up
npm run prisma:generate
npm run prisma:migrate:deploy
```

Для ручной локальной проверки используйте mock-интеграции. Иначе недоступный
внешний embedder/reranker будет давать задержки при публикации и readiness 503.
Либо выставьте эти значения в локальном `.env`, либо запустите одной командой:

```bash
EMBEDDING_PROVIDER=mock \
EMBEDDING_MODEL=mock-hashed-bow-v1 \
EMBEDDING_SPEC_ID=mock-hashed-bow-v1:benchmark-test-document-v1:dim-1536:l2 \
RERANKER_PROVIDER=mock \
RERANKER_MODEL=mock-lexical-reranker-v1 \
npm run start:dev
```

Если `GET http://localhost:3000/api/health/ready` вернул 503 после смены
провайдера или миграций, в отдельном терминале один раз пересоберите read-model
с теми же mock-переменными:

```bash
EMBEDDING_PROVIDER=mock \
EMBEDDING_MODEL=mock-hashed-bow-v1 \
EMBEDDING_SPEC_ID=mock-hashed-bow-v1:benchmark-test-document-v1:dim-1536:l2 \
RERANKER_PROVIDER=mock \
RERANKER_MODEL=mock-lexical-reranker-v1 \
npm run search:reindex
```

Готовый backend должен отвечать:

- Swagger: `http://localhost:3000/api`;
- liveness: `http://localhost:3000/api/health/live` → 200/up;
- readiness: `http://localhost:3000/api/health/ready` → 200/up.

Локальный SuperUser по `.env.example`: `admin` / `admin1234!@$%`. Если ваши
локальные credentials отличаются, поменяйте только Postman environment.

### Frontend

```bash
cd /Users/keofoxy/Development/SberDevices/benchmark-catalog/benchmark-catalog-front
npm install
npm run dev
```

Открыть: `http://localhost:5174`.

## 2. Postman: живой API regression-smoke

Импортируйте два файла:

1. `postman/benchmark-catalog-checkpoint.postman_collection.json`;
2. `postman/benchmark-catalog-checkpoint-local.postman_environment.json`.

Выберите environment **Benchmark Catalog — Checkpoint Local**, затем у
коллекции **Benchmark Catalog — Business Checkpoint** нажмите **Run collection**.
Порядок запросов менять нельзя; параллельный запуск выключить.

Папку `05 — Soft delete и restore без результатов` можно затем перезапускать
отдельно: её первый запрос каждый раз генерирует уникальное имя lifecycle Test
и сохраняет новый `lifecycleTestId`. Начинать папку нужно именно с первого
запроса — остальные используют созданный им UUID.

Ожидаемый итог текущей версии:

- 53 request;
- 86 assertions;
- 0 failed;
- ожидаемые 4xx — это зелёные negative-cases, а не ошибки коллекции.

Cookie авторизации сохраняется Postman автоматически. Если login проходит, а
следующий защищённый запрос возвращает 401, откройте cookie jar для
`localhost`, удалите старую `access_token` и запустите коллекцию заново.

Коллекция проверяет:

1. health, cookie-auth и закрытый management API;
2. глобальные Metric lookups/definitions и запрет Test-полей на Metric;
3. создание Benchmark, Test и DatasetSubsample;
4. единственный moderation state в CatalogEntry;
5. обязательную Metric перед публикацией и public visibility;
6. отсутствие Run и subsample-scoped MetricResult;
7. запрет synthetic Human, чужой Metric и общего score;
8. неизменяемость Test после первого результата;
9. авторство submission, роли, reject reason и повторную публикацию;
10. soft-delete, restore и идемпотентный restore.

После прогона сохраните значение collection variable `runSuffix`: по нему можно
найти ровно ваш набор данных в UI и БД.

## 3. Что проверить глазами во frontend

### Публичный каталог

1. Откройте `/` и найдите `Postman Test <runSuffix>`.
2. Убедитесь, что карточка находится внутри `Postman Benchmark <runSuffix>`.
3. Проверьте поиск и фильтры; карточка не должна дублироваться.
4. Откройте карточку. Не должно быть терминов `SubDataset`, `DatasetSubset` или
   `Run`.

### Карточка Test

1. На overview проверьте Test-level evaluation logic и human baseline `0.93`.
2. Откройте `DatasetSubsamples`: должен быть один элемент
   `Visual validation <runSuffix>`, split `validation`, 25 samples.
3. Откройте `Результаты`: доступны две отдельные Metric — Accuracy и Latency.
4. Переключитесь между Metric. Значения `0.81` и `230` не должны складываться,
   усредняться или превращаться в общий score.
5. Human baseline отображается отдельно, а не как модель в рейтинге.

### Admin

1. Войдите локальным SuperUser и откройте `/admin`.
2. Во вкладке Test найдите все записи текущего `runSuffix`.
3. Откройте редактирование основного `Postman Test`: поля GigaMetrics adapter и
   DatasetSubsample должны быть заполнены.
4. Попытка сохранить изменение основного Test после результатов должна показать
   conflict/ошибку и не изменить данные.
5. Во вкладке «Валидация» не должно быть уже опубликованных Postman-записей.
6. В категориях найдите `Postman Benchmark <runSuffix>`; удалить его при
   активных Test нельзя.

### Обычный пользователь и личный кабинет

Postman создал пользователя, его логин и пароль лежат в collection variables
`userUsername` и `userPassword`.

1. Выйдите из admin и войдите этим пользователем.
2. Откройте `/profile`: `Postman User Submission <runSuffix>` должен быть в
   разделе собственных submissions со статусом `published`.
3. Карточка опубликованного submission должна открываться из профиля и быть
   доступна в общем каталоге.
4. Пользователь не должен видеть admin-раздел и действия модерации.

## 4. Контрольный автоматический прогон перед коммитом

```bash
cd /Users/keofoxy/Development/SberDevices/benchmark-catalog/benchmark-catalog-back
npm run verify

cd /Users/keofoxy/Development/SberDevices/benchmark-catalog/benchmark-catalog-front
npm run lint
npm test
npm run build
```

## 5. Куда смотреть в diff

Backend:

- `src/catalog/benchmark-test/` — Test, DatasetSubsample, immutability;
- `src/catalog/catalog-entry/` — submissions, авторство, moderation;
- `src/catalog/benchmark/` — Benchmark-группы и ограничения удаления;
- `src/metrics/` — Metric/Model/MetricResult и границы контракта;
- `src/benchmark-service/` и `src/catalog/projection/` — будущая Kafka-граница;
- `prisma/models/` и новые `prisma/migrations/202609*` — схема и миграции;
- `test/*.e2e-spec.ts` — сквозные corner-cases.

Frontend:

- `src/api/catalog/` и `src/api/metrics/` — обновлённый API-контракт;
- `src/pages/BenchmarkDetail/` — DatasetSubsample, human baseline, отдельные Metric;
- `src/pages/AdminPanel/` — management и moderation;
- `src/pages/Profile/ui/SubmissionsSection.tsx` — submissions текущего автора;
- `src/pages/Dashboard/` — отдельный выбор Metric без общего score.

Быстрый обзор изменений:

```bash
git -C /Users/keofoxy/Development/SberDevices/benchmark-catalog/benchmark-catalog-back status --short
git -C /Users/keofoxy/Development/SberDevices/benchmark-catalog/benchmark-catalog-back diff --stat
git -C /Users/keofoxy/Development/SberDevices/benchmark-catalog/benchmark-catalog-front status --short
git -C /Users/keofoxy/Development/SberDevices/benchmark-catalog/benchmark-catalog-front diff --stat
```

## 6. Что прислать при ошибке

Для воспроизводимого разбора достаточно:

- название упавшего Postman request или шаг UI;
- фактический HTTP status и response body;
- `runSuffix`;
- последние backend logs вокруг запроса;
- скриншот и URL страницы для UI-ошибки.
