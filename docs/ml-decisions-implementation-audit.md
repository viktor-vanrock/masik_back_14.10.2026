# Аудит решений ML-инженера

> **Исторический документ.** Содержимое ниже фиксирует прежний этап/план и может описывать монолит, переходные таблицы, будущий Run или уже неактуальные команды. Для работы после разделения используйте [актуальную архитектуру](architecture.md), [локальный запуск](local-development.md) и [тестирование](testing.md). Не воспринимайте этот файл как текущий контракт.

## Актуализация поиска — 06.10.2026

По запросу владельца каталога восстановлен GigaChat-путь из изменений
`e6258cd`/`5b82e80`: `Embeddings-2`, 1024 измерения, нормализация L2,
чанки до 400 UTF-8 байт с объединением по длине и PostgreSQL FTS RU/EN +
pgvector. При недоступности embeddings текстовый поиск читает опубликованные
Catalog-проекции. Старые сетевые Qwen embedder и reranker не участвуют в этом
пути; legacy env не должны возвращать обращения к их адресам.

Это перенос поискового поведения в действующую архитектуру разделения:
Benchmark Service сохраняет исходные Benchmark/Test/DatasetSubsample,
Catalog — проекции, модерацию, результаты и производные search documents.
Перестраивается только поисковый индекс существующих данных; повторный seed,
сброс БД и очистка Kafka/Redis не нужны. Точный env и reindex порядок:
[deployment.md, раздел 10](deployment.md#10-переход-существующего-каталога-на-gigachat-и-гибридный-поиск).

Factory `6b88440` сохраняет conversational interviewer и Redis-контекст:
его search tool обращается к Catalog `search-agent`. Выбор кандидатов через
Factory остаётся опциональным, по умолчанию используется ранжирование
retrieval. Реальная доступность GigaChat OAuth/API/CA и качество поиска
проверяются на контуре отдельно от автоматических тестов с synthetic responses.

## Историческая проверка V1

**Проверено:** 2026-09-06  
**Итог:** подтверждённые ML-инженером поведенческие разрывы текущей V1
устранены. Ответы про `Run`, `ModelVersion` и воспроизводимость описывают
будущее расширение системы исполнения оценок, которого в текущем продукте ещё
нет. Это отдельный scope и не блокер хирургического выноса существующих
Benchmark/Test без изменения поведения.

| Решение | Состояние кода | Защита |
| ------- | -------------- | ------ |
| Канонический термин `DatasetSubsample` | Поведение соответствует, идентификаторы стабильны при update; БД/API всё ещё содержат переходные `DatasetSubset`/`subDatasets` | DTO + PostgreSQL e2e; переименование впереди |
| Полные данные находятся во внешней системе | Test хранит metadata, stats, examples и links | contract/e2e |
| MetricResult только для Test | `subsetId` запрещён во входном API и исключён из чтений | DTO, repository, unit/e2e |
| DatasetSubsample не имеет собственной taxonomy | Дочерние task/domain/subdomain запрещены и наследуются в ответе | DTO, mapper, unit/e2e |
| Evaluation logic находится в Test | Metric API не принимает/возвращает поле | contract/unit/e2e; legacy DB column впереди |
| Перед публикацией/запуском нужна Metric | Проверено на create/update/moderation/result | unit/integration/e2e |
| Несколько Metric не образуют единый score | Результаты возвращаются отдельно по Model–Metric | unit/e2e |
| Human baseline — отдельное поле Test | Синтетический `modelId=human` запрещён | unit/e2e |
| GigaMetrics adapter config находится в Test | Поля Test сохранены; Metric API их запрещает | contract/e2e |
| Recommendation и Interviewer payload выбирают конкретный Test | Поля и transport payload переименованы из вводящего в заблуждение `benchmarkId` в `testId`; исторические JSON snapshots мигрируются, legacy-вход Interviewer нормализуется | migration/unit/e2e/frontend build |
| Test после результатов нельзя менять на месте | Specification update/delete запрещены до versioning | unit/e2e |
| Run = Test + ModelVersion + параметры запуска | Согласовано для будущего execution-модуля; не является текущей функцией | отложено осознанно |
| Повторный запуск создаёт новый Run | Согласовано для будущего execution-модуля | после появления Run |
| Run создаёт несколько MetricResult | Согласовано для будущего execution-модуля | после появления Run |
| Частично успешного Run быть не должно | Согласована будущая атомарная state machine | после появления Run |
| Воспроизводимость: TestVersion, ModelVersion, seed, generation params | Согласовано для будущего execution-модуля | после появления Run |

## Что действительно требуется перед физическим выносом Benchmark

1. Зафиксировать transport-neutral Benchmark/Test commands, events и
   контрактные тесты.
2. Устранить hard FK `CatalogEntry → BenchmarkTest`, заменив его стабильной
   межсервисной ссылкой и локальной Kafka-проекцией Catalog.
3. Разделить владение данными и БД и доказать перенос snapshot/reconciliation-
   тестами.
4. Переименовать `DatasetSubset`/`subDatasets` в `DatasetSubsample` с
   контролируемым API compatibility window.
5. Удалить legacy evaluation/GigaChat поля из `MetricDefinition` после аудита
   данных.

## Независимое будущее расширение Metrics/Evaluation

`ModelVersion`, полноценный `TestVersion`, `Run`, обязательный `runId` у
`MetricResult` и атомарный terminal state Run проектируются вместе, когда
появится реальная функция запуска оценок. Создание пустого агрегата Run до его
потребителя только добавило бы миграционный риск и не помогло бы сохранить
поведение текущего каталога.

## Тестовая оговорка

Зелёные тесты доказывают перечисленные сценарии, но не означают абсолютного
отсутствия дефектов. Новые тесты обязаны проверять негативные ветки, race,
duplicate, retry, out-of-order, rollback и реальные PostgreSQL constraints, а
не только happy path с mock-объектами.
