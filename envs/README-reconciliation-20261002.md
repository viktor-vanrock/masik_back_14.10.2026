# Сохранение DevOps при объединении веток — 02.10.2026

Основа приложения — `new-microservice`; исходные Benchmark/Test принадлежат
Benchmark Service. Инфраструктура сверена со свежими `origin/main` (`f13416b`)
и `origin/develop` (`00b6ce2`) после fetch. Автор изменений инфраструктуры:
`Кондратюк Захар Игоревич` / `zikondratyuk`.

## Сохранённые изменения Захара

| Коммиты | Сохранённое поведение |
| --- | --- |
| `85a7e38` / `6ed2565` | Vault выдаёт Kafka mTLS-сертификат и ключ для dev/prod. |
| `862e2dc` / `a4015d3` / `df921d2` | `agent-pre-populate-only` предотвращает повторную выдачу PKI-сертификатов; лишний TTL удалён; в values один блок `podAnnotations`. |
| `a3b6d5f` | `dockerfiles-registry-pull` сохранён у отдельного Redis, который использует образ из другого registry namespace. |
| `a2e0349` | Redis — отдельный общий release `benchmark-catalog-redis`, без sidecar в приложении. Это итоговая замена прежнего sidecar из `3bd7ede`. |
| `dd331cf` | `VERSION_IMAGE=7.4-alpine` не позволяет шаблону деплоя подставить версию приложения в Redis image tag. |
| `4ced32f` / `f530ce7` | Сохранены dev/prod Redis jobs и values; Vault export использует base64 для корректной передачи специальных символов. |
| `f13416b` / `00b6ce2` | `kafka-ca.pem` содержит полную `.Data.ca_chain`, включая intermediate и root. |

`.deploy.yml` и оба Redis values перенесены из `f13416b` без изменений.
Все Vault annotations основных dev/prod values совпадают с этой ревизией.
Сохранены существующие namespaces, Vault roles, service accounts, ingress,
probes, ресурсы и ручной запуск deployment jobs.

## Совместимость с разделением сервисов

В основных values сохранена команда запуска ветки разделения: загрузка
Vault config, применение миграций и запуск приложения. Автоматическая замена
каталога Q3 и `search-index` initContainer из монолитной ветки не перенесены.
Начальные Benchmark/Test загружаются штатным `seed:catalog` через Kafka API;
процедура описана в [инструкции развёртывания](../docs/deployment.md).

CI явно вызывает `scripts/patch-kafkajs.cjs` перед `npx nest build`.
Генерация Prisma сохранена в отдельной стадии на kube-stage. Ранее сочетание
`npm ci --ignore-scripts` и `npx nest build` пропускало пользовательское
исправление KafkaJS. Dockerfile
явно задаёт `NODE_ENV=production` и сохраняет запуск без Q3 sync.

В соседнем Benchmark Service следует использовать свежую ревизию `49f52f2`
из main/develop: она уже содержит deployment jobs/values, сборку образа из
CI artifacts (`3b2c80e`), internal Harbor proxy (`231214f`), генерацию Prisma
на kube-stage (`e142612`) и полную Kafka CA chain (`49f52f2`). Старый локальный
`bec7939` не содержит всех этих изменений инфраструктуры.

## Что требуется от окружения

- У каталога и Benchmark Service разные `DB_URL` и базы. Нельзя подключать
  старый монолит к новой схеме после удаления исходных таблиц Benchmark/Test.
- В обоих сервисах включён Kafka; brokers/topics должны соответствовать
  одному контуру. Consumer group каталога отличается от consumer group
  Benchmark Service. Каталог работает с
  `BENCHMARK_SERVICE_READ_MODE=projection` и
  `BENCHMARK_SERVICE_WRITE_MODE=remote`.
- В pod существуют `/vault/secrets/kafka-ca.pem`, `kafka-cert.pem`,
  `kafka-key.pem`; при другой схеме монтирования задаются все три
  `KAFKA_SSL_*_FILE`. После ротации сертификатов нужен перезапуск pod:
  файлы читаются при старте процесса.
- Redis доступен обоим приложениям как `benchmark-catalog-redis:6379`.
  В Vault согласованы `REDIS_HOST`, `REDIS_PORT`, `REDIS_DB`, `REDIS_PASSWORD`.
  Для Factory с Redis storage требуется `INVENTOR_STORAGE=redis`.
- Для интервью `AGENT_MODE=ws`, `THIRD_PARTY_WS_URL` указывает на Factory
  `/ws/interviewer`; `THIRD_PARTY_API_KEY` каталога совпадает с
  `SERVICE_AUTH_TOKEN` Factory. Для исходящих запросов к creator API настройка
  `creator_base_url` Factory содержит URL каталога с префиксом `/api`.
- Модельные endpoints и credentials задаются в Vault согласно сохранённым
  конфигурациям GigaChat/Factory. Значения секретов не входят в этот документ.

Перед первой раскаткой разделения нужны backup БД, проверка плана bootstrap
и порядок запуска из [deployment.md](../docs/deployment.md). Эти изменения
Git не запускают deployment jobs, миграции, очистку Kafka или загрузку seed.

## Проверка изменений

Все шесть YAML-файлов разобраны `js-yaml` с поддержкой GitLab `!reference`.
Программно сверены полное совпадение `.deploy.yml`, Redis values и основных
Vault annotations с `f13416b`, pinned Redis image tags, пути values,
отсутствие Q3 startup/initContainer и выполнение KafkaJS patch в CI. Shell-команды
app/Redis прошли `sh -n`; `git diff --check` прошёл.

Удалённый Helm chart из `rndml/devops/helm-template` в этом checkout отсутствует;
рендер манифестов Helm и проверка действующего кластера здесь не выполнялись.
