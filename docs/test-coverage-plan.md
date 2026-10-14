# План покрытия Benchmark Catalogue тестами

> **Исторический документ.** Содержимое ниже фиксирует прежний этап/план и может описывать монолит, переходные таблицы, будущий Run или уже неактуальные команды. Для работы после разделения используйте [актуальную архитектуру](architecture.md), [локальный запуск](local-development.md) и [тестирование](testing.md). Не воспринимайте этот файл как текущий контракт.

План основан на [доменном контракте](benchmark-domain-contract.md). Он отделяет
характеризацию корректного текущего поведения от regression-тестов на уже
подтверждённые расхождения.

Обозначения:

- **unit** — чистое правило без настоящей БД;
- **integration** — service/repository с настоящим PostgreSQL;
- **e2e** — публичный HTTP/WebSocket-контракт через NestJS;
- **red-green** — сначала тест на целевое правило, затем исправление в той же
  задаче; неправильное текущее поведение не становится постоянным контрактом.

## 1. Готовый фундамент

| Область                                       | Тип            | Статус |
| --------------------------------------------- | -------------- | ------ |
| Production-like bootstrap и `/api` prefix     | e2e            | готово |
| PostgreSQL, migrations и pgvector readiness   | e2e            | готово |
| Изолированная одноразовая test DB             | infrastructure | готово |
| Защита от reset нетестовой БД                 | infrastructure | готово |
| Единая конфигурация production/e2e приложения | infrastructure | готово |
| Отдельный TypeScript check для test source    | infrastructure | готово |

## 2. P0 — текущий HTTP-контракт Benchmark/Test и Catalog

| Сценарий                                                              | Тип             | Подход           | Статус |
| --------------------------------------------------------------------- | --------------- | ---------------- | ------ |
| List/search/options активных Benchmark                                | e2e             | characterization | готово |
| Активный Test count внутри Benchmark                                  | e2e             | characterization | готово |
| Роли create/update/delete/restore Benchmark                           | e2e             | characterization | готово |
| Уникальность имён Benchmark                                           | e2e             | characterization | готово |
| Запрет удаления Benchmark с активным Test                             | e2e             | characterization | готово |
| Полный Test aggregate: taxonomy, metrics, examples, links, subsamples | e2e             | characterization | готово |
| Проверка родительских связей taxonomy                                 | e2e             | characterization | готово |
| Replacement semantics коллекций Test                                  | e2e             | characterization | готово |
| Soft delete/restore Test и search document                            | e2e             | characterization | готово |
| Запрет Test под отсутствующим/удалённым Benchmark                     | e2e             | characterization | готово |
| Grouped Catalog и сокрытие пустых групп                               | e2e             | characterization | готово |
| Обе ветки Catalog search variant A                                    | e2e             | characterization | готово |
| Фильтры Test по каждой taxonomy-связи                                 | integration/e2e | characterization | готово |
| Pagination и стабильная сортировка Test/Catalog                       | integration/e2e | characterization | готово |
| Уникальность Test в пределах Benchmark                                | integration/e2e | characterization | готово |
| Полный update/move/restore конфликтов Test                            | integration/e2e | characterization | готово |
| Omitted/empty/null semantics при PATCH                                | e2e + frontend  | regression       | готово |
| Дедупликация повторных metric/skill/tag до записи                     | e2e + frontend  | regression       | готово |
| Внешний Benchmark/Test API: key, scope, mapping, fields               | e2e             | contract         | готово |
| Frontend URL/query/payload contract                                   | unit            | contract         | готово |

Пока оба bounded context находятся в одном приложении, эти тесты проходят через
общий HTTP API. Перед выделением сценарии Benchmark/Test переносятся в reusable
contract suite: один и тот же набор должен уметь запускаться против внутреннего
порта монолита и URL нового Benchmark Service. Catalog e2e остаются в этом
репозитории и проверяют интеграцию с fake/real Benchmark Service.

## 3. P0 — подтверждённые расхождения

Каждая строка реализуется отдельным red-green изменением.

| Целевой инвариант                                                              | Основной уровень   | Статус |
| ------------------------------------------------------------------------------ | ------------------ | ------ |
| Публично видны только `published` Test и их результаты                         | e2e                | готово |
| Прямой ID чужого непубличного Test не раскрывает его                           | e2e                | готово |
| DatasetSubsample наследует taxonomy Test и не принимает собственную            | contract/e2e       | готово |
| DatasetSubsample сохраняет id при update; foreign/duplicate id откатывает patch | PostgreSQL e2e     | готово |
| Пользователь может отправить Test на `validation`, но не назначить иной статус | e2e + frontend     | готово |
| CatalogEntry хранит серверное авторство и виден автору в личном кабинете       | integration/e2e + frontend | готово |
| Только автор восстанавливает удалённую заявку; чужой id не раскрывается        | e2e                | готово |
| Moderation требует роль, reason для reject и сохраняет reviewer audit          | e2e + frontend     | готово |
| CatalogEntry побеждает конфликтующий legacy validationStatus во всех read-path | e2e                | готово |
| Перед публикацией Test имеет хотя бы одну Metric                               | integration/e2e    | готово |
| MetricResult разрешён только для заранее назначенной Metric                    | integration/e2e    | готово |
| Создание MetricResult не меняет TestMetric                                     | integration        | готово |
| MetricResult не принимает DatasetSubsample                                     | contract/e2e       | готово |
| Test с результатами нельзя менять                                              | integration/e2e    | готово |
| Разные MetricResult отображаются отдельно, без неявного общего score           | unit/e2e           | готово |
| Human baseline не выводится как специальная Model                              | unit/integration   | готово |
| `evaluationLogic` имеет один API-источник — Test                               | contract/e2e       | готово; cleanup legacy БД впереди |
| Race уникальности create/update Benchmark/Test/Metric преобразуется в 409       | unit/e2e           | готово |
| Дубликаты taxonomy ID не дают ложный missing-id                                | unit               | готово |
| Conversation читается только владельцем или администратором                    | unit/e2e           | готово: auth, owner scope, скрытый foreign ID, Admin/SuperUser |

## 4. P1 — taxonomy и метрики

| Сценарий                                                 | Тип                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------ |
| Case-insensitive uniqueness всех справочников            | PostgreSQL e2e — готово, включая parent-scoped child names   |
| Иерархии macro group/subgroup и domain/subdomain         | integration/e2e — готово для обеих иерархий                  |
| Запрет удаления используемого элемента taxonomy          | PostgreSQL e2e — готово для всех 10 типов                     |
| Soft delete/restore справочника и filter options         | integration/e2e — soft delete готов, restore API отсутствует |
| CRUD Metric и проверка диапазона                         | unit/e2e — готово                                            |
| Независимость Metric от Benchmark/Test                   | integration                                                  |
| Несколько Metric у одного Test без агрегации             | integration/e2e — готово                                     |
| Удаление/архивирование Metric без потери истории         | integration/e2e — удаление используемой Metric запрещено API и FK; archive API впереди |
| Валидация Model и результата                             | integration/e2e — основные FK и pagination готовы            |
| Повторная загрузка результата и текущая семантика latest | characterization — готово                                    |

## 5. P1 — поиск, рекомендации и создание

| Сценарий                                                                   | Тип                |
| -------------------------------------------------------------------------- | ------------------ |
| Индексируются только опубликованные активные Test                          | integration/e2e — готово |
| Update/restore/archive корректно синхронизируют search document            | integration        |
| Сбой embedder не откатывает каталог, readiness показывает рассинхронизацию | unit/PostgreSQL e2e — готово; reindex восстанавливает readiness |
| Рекомендации возвращают только актуальные published Test                   | integration/e2e — готово, включая revalidation и stale version |
| Recommendation contract использует `testId`, включая legacy JSON recovery | unit/e2e — готово |
| Reranker fallback сохраняет порядок pgvector                               | unit — уже покрыто |
| Отказ от рекомендации переводит workflow в `create_new`                    | e2e WebSocket      |
| Interviewer result превращается в трассируемую пользовательскую submission | unit/e2e + frontend — готово |
| Повторные WebSocket-события не дублируют действия                          | unit/PostgreSQL e2e — select/reject race готов |
| Лимит WS-сессий, bounded buffer, backpressure и очистка                    | unit + concurrent smoke — готово |
| Параллельные recommendation pipeline не превышают admission limit          | unit — готово      |

## 6. P1 — внешние контракты и импорт

| Сценарий                                          | Тип                                        |
| ------------------------------------------------- | ------------------------------------------ |
| External API key scopes read/write                | e2e — Benchmark/Metric/Model/Result готовы |
| External API возвращает только published Test и результаты | red-green e2e — готово                |
| External metric/model/result contract             | e2e — готово                               |
| Catalog import идемпотентен                       | PostgreSQL integration — готово            |
| Import не удаляет DatasetSubsample examples       | PostgreSQL integration — готово            |
| Import синхронизирует search documents            | integration — stale document атомарно удаляется; автоматический reindex впереди |
| Ошибка одной записи не оставляет частичный import | PostgreSQL integration — готово            |

## 7. P2 — analytics и будущий Run

Сценарии Run не входят в regression-контур текущей V1 и не блокируют выделение
Benchmark Service. Они активируются только вместе с отдельным функциональным
scope исполнения оценок в Metrics/Evaluation.

| Сценарий                                                       | Тип                                     |
| -------------------------------------------------------------- | --------------------------------------- |
| Analytics принимает только согласованные Benchmark/Test ссылки | integration                             |
| События сохраняются после архивирования каталога               | integration                             |
| Run state machine                                              | unit/integration после появления модели |
| Один Run = один Test + одна ModelVersion                       | integration после появления модели      |
| Идемпотентный приём MetricResult внутри Run                    | integration после появления модели      |
| Атомарное завершение/падение Run                               | integration после появления модели      |
| Снимок версии Test и параметров запуска                        | integration после появления модели      |

## 8. Definition of done перед выделением сервиса

- Все P0-тесты зелёные.
- Весь набор запускается одной документированной командой.
- Тесты не используют dev/prod БД и не требуют ручной подготовки данных.
- Публичное поведение Benchmark/Test/Catalog покрыто e2e.
- Транзакции, связи и ограничения покрыты integration-тестами на PostgreSQL.
- Нет тестов, которые случайно объявляют подтверждённый дефект правильным
  контрактом.
- Контрактные тесты можно выполнить против монолита и будущего микросервиса.
- Catalog проверен с недоступным, медленным и вернувшим устаревшую версию
  Benchmark Service.
- Frontend API tests фиксируют сериализацию query, URL и request payload для
  изменяемых вместе frontend/backend контрактов.

## 9. Kafka и database-per-service

| Сценарий | Тип | Статус |
| -------- | --- | ------ |
| Business row и Outbox записываются атомарно | PostgreSQL integration | впереди |
| Повторный `eventId` даёт один бизнес-эффект | PostgreSQL integration | впереди |
| Повтор Kafka position с иным `eventId` блокируется | PostgreSQL integration | впереди |
| Producer reconnect/concurrent connect/shutdown | unit | готово |
| Consumer connect/failure cleanup/readiness/shutdown | unit | готово |
| Kafka health требует все контрактные topic и чистит admin connection | unit | готово |
| Outbox deterministic claim/publish/fail compare-and-set | unit | готово |
| Retry/backoff переживает restart | integration | publisher unit foundation готов, Benchmark flow впереди |
| Исчерпание попыток приводит в DLQ | integration | repository foundation готов, Benchmark flow впереди |
| Бизнесовая ошибка не ретраится как техническая | unit/integration | впереди |
| Stale/out-of-order aggregate version не откатывает projection | integration | впереди |
| Submission saga: success/reject/timeout/duplicate | integration/e2e | впереди |
| Catalog читает snapshot при недоступном Benchmark/Kafka | e2e/chaos | впереди |
| Projection полностью перестраивается из событий/snapshot | integration | впереди |
| Snapshot copy + catch-up не теряет и не дублирует строки | migration/reconciliation | впереди |
