# Регрессионная проверка перед dev-раскаткой — 5 октября 2026

> Это исходный протокол прогона. Последующие исправления ревью и новые результаты приведены в [разборе ревью](review-resolution-20261005.md). После повторного fetch Factory develop стал `8c8c276` вместо `72b6b03`; новая модель Interviewer требует отдельной проверки на настоящем gateway. Указанные ниже SHA и результаты сохранены как история проверенного контура, а не как подтверждение текущего merge или deployment.

## Решение по исходным веткам

Текущие main/develop нельзя считать согласованным микросервисным релизом. После fetch backend develop =25b9a25 уже содержит распил, backend main=f13416b остаётся монолитом. Frontend develop=4a68021 и main=8160352 ещё не включают интеграцию9468e4c. Benchmark Service main/develop=49f52f2; Factory develop=72b6b03/main=1bdbc02.

Это подтверждено не только Git: настоящий Chrome открыл current frontend develop /catalog против current backend develop и получил пустую страницу с `Cannot read properties of undefined (reading 'map')`. Старый frontend ожидает subDatasets/benchmarkId и синхронный CRUD, новый API выдаёт datasetSubsamples/testId и202 operationId. Одинаковые6 контрактных тестов: current main0/6, current develop0/6, integration6/6.

Main frontend+main backend прошли базовый браузерный smoke каталогаQ3, карточки, логина и админки, но это монолит. Backend main также не передаёт ssl Kafka-клиенту и не соответствует новому Factory Producer dataset_type/partial-result контракту. Приёмкой разделения такой smoke не является.

## Сохранность и история

Критичные Kafka/Outbox, Benchmark Service bridge, projections, publication/moderation, metrics, analytics и старые split migrations в интеграции сохранены. После последних самостоятельных KeoFoxy-коммитов30сентября новых коммитов Астафурова в проверенных main/develop нет; проблема — продвижение веток. Подробная таблица переносов/исключений и все авторские коммиты: astafurov-audit.md.

Сохранены GigaChat OAuth/chunking как дополнительный provider, Factory selection/explanations, Inventor jobs/progress/cancel/retry, Producer dataset_type/частичные результаты, пользовательский selectedIndices, legacy interviewer endpoint поверх published projections. Исключены автоматическаяQ3-перезапись, монолитные SQL/триггеры, отдельный MAS-редизайн и замена исходного projection/reranker поиска. Factory-реализации отдельно протестированы, не переписаны.

## Реальный локальный контур

Созданы отдельные PostgreSQL/pgvector55540, Benchmark DB55541, Redpanda29092, Vault Transit18200, Redis16379. Рабочие локальные контейнеры5432/55433/19092/8200 не затрагивались. Секреты исключительно синтетические. Исходный seed40 Test создан через HTTP→Kafka→Benchmark Service→проекции, без вставки доменных Test в каталог напрямую. Topology smoke прошёл create/rejected duplicate/update/delete/restore/convergence.

Запросы в корпоративные модели, MSK/Vault и deployment не выполнялись. Модельные ответы/worker results синтетические; для main был отдельный HTTPS OAuth/embedding fixture. Это проверяет транспорт/хранение/интерфейс, но не качество настоящей генерации и не сетевые настройки контура.

Встроенный инструмент браузера не запустился (runtime Unknown option -c); применён отдельный настоящий Chrome с Playwright. Действия выполнялись через поля, ссылки, кнопки и чекбоксы, а не через подмену ответов frontend.

## Автоматические проверки исходных SHA

| Компонент | Результат |
|---|---|
| Backend develop25b9a25 | lint/types/build;370 unit/HTTP/SQL,88 PostgreSQL e2e,7 seed checks — PASS |
| Backend mainf13416b | build/types,185 unit — PASS; lint3 ошибки; исходный e2e не стартует из-за отсутствующего @/ alias |
| Frontend main8160352 | lint/build,215 tests — PASS;6 shared split-contract tests FAIL |
| Frontend develop4a68021 | lint/build,219 tests — PASS;6 shared split-contract tests FAIL |
| Frontend integration9468e4c | lint/build,270 tests+6 shared split-contract tests — PASS |
| Benchmark Service49f52f2 | lint/types/build,45unit+25DB e2e+3realKafka — PASS |
| Factory main1bdbc02 |165 targeted service/contract/worker tests — PASS |
| Factory develop72b6b03 |179 targeted tests включая10Producer adapter — PASS |

Factory-прогон не является всей ML/evolution suite: указанные targeted тесты прошли без исключений/skips, реальные LLM не вызывались. Версии runtime и команды сохранены в factory/.

## Ручные сценарии браузера и API

- Публичные40 карточек, поискGPQA→1результат и сохранение URL/поиска после reload.
- Карточка: overview/examples/results/sources, RU/EN; все7 вкладок админки.
- Пятишаговая UI-заявка с таксономией/параметрами/примером:202→applied→свой профиль.
- Модерация запрещает approve без метрики; назначение метрики через редактор202, публикация через UI, карточка появляется публично.
- API-результат85.25 виден в карточке/дашборде. Через UI загружено91.75, POST201, значение сохранено после reload; график проверен после анимации.
-20Inventor examples восстановлены в UI; все20 чекбоксов выбраны; пустой выбор блокирует масштабирование; выбор2и20 отправляет selectedIndices[1,19] с правильным creatorJobId.
-Producer реально claim-ит выбранные seeds; синтетический результат3из4; UI показывает3accepted/1filtered; скачанныйJSONL содержит3строки; reload сохраняет выбор.
-Отдельный USER видит свои заявки и пустую историю; чужой диалог возвращает404 и не отображается; /admin→forbidden.
-API generation/production/ownership/CSRF/Vault:127assertions/97HTTP PASS. Повторено на исправленном runtime —127/0.
-Live business API: owner submission, publication metric requirement, partial PATCH, source/projection convergence, referenced taxonomy protection, assigned metrics, source locking after first result, roles, soft-delete/restore and deletedId conflicts.

UI артефакты и screenshots: evidence/. Harness locator/debounce/context/download ошибки сохранены в runtime-скриптах/истории; они не считаются дефектами приложения. Итоговые успешные результаты вынесены в evidence/browser-summary.json.

## Найдено и исправлено в отдельных ветках

1. PATCH обязательных полей Test/Metric с null давал500; datasetSubsamples:null незаметно стирал массив. DTO теперь отклоняет неразрешённый null с400 до Outbox/записи, разрешённые nullable поля остаются nullable, пропуск сохраняет, []явно очищает.370unit+91DB e2e PASS; live fixed business101/101PASS, включая все прежние500и сохранение данных.
2. Профиль во всех исходных ветках показывал MOCK_DIALOGUE benchmarkName/session1. Переведён на настоящий owner-scoped API с honest loading/error/empty и корректными UUID-ссылками; в браузере подтверждена реальная собственная сессия.
3. USER post-login /add-benchmark redirect: найдены неверный access-rule и реальная гонка Login NavigateHOME с AuthProvider destination. Исправлен общий выбор разрешённого returnTo для AuthProvider/Login/Register и захват адреса до async profile. Реальный Chrome подтвердил стабильный переход USER на/add-benchmark, рабочую валидацию формы и отказ /admin. Frontend итог: lint/build,47files/278tests PASS.

Исправления не заменяют необходимость смержить согласованный frontend вdevelop и затем продвигать проверенный комплект вmain. Исходные remote main/develop во время этой проверки не переписывались.

## Проверка миграции и передача DevOps

На отдельной заполненной upgrade DB применены main migrations, затем develop. SQL-переход прошёл; Creator/Producer results и selected-index backfill сохранены. Но legacy source benchmark_tests удаляется, при этом один старый CatalogEntry остаётся с0Test projections. Следовательно migrate deploy НЕ переносит доменные данные в Benchmark Service. Нужен согласованный чистый bootstrap либо экспорт/перенос/replay до удаления старых таблиц, с backup и контролируемым переключением writers.

До dev-приёмки:1) принять согласованные исправленные frontend/backend MR;2)зафиксировать Service49f52f2 и Factorydevelop72b6b03;3)настроить отдельныеDB/Kafka groups/mTLS, Factory tokens/URLs, opt-in GigaChat/selection;4)выбрать bootstrap/data-transfer;5)повторить стендовый smoke с настоящими моделями и корпоративной сетью. Main продвигать только тем же проверенным комплектом. Зелёная локальная suite не равна проверке реального deployment.
