# Benchmark Catalog Back: схема Catalog + Metrics

> **Исторический документ.** Содержимое ниже фиксирует прежний этап/план и может описывать монолит, переходные таблицы, будущий Run или уже неактуальные команды. Для работы после разделения используйте [актуальную архитектуру](docs/architecture.md), [локальный запуск](docs/local-development.md) и [тестирование](docs/testing.md). Не воспринимайте этот файл как текущий контракт.

## Главная идея

В проекте есть две связанные области:

```text
CatalogModule
  хранит описание benchmark-карточек, таксономию, ссылки, инструкции, примеры

MetricsModule
  хранит определения метрик, модели и конкретные значения метрик для моделей
```

Ключевое доменное разделение:

```text
Benchmark     = suite / контейнер / набор тестов
BenchmarkTest = конкретная карточка каталога, которую видит фронт
```

Фронт получает `Benchmark`-подобный DTO, но внутри бэка это данные из `BenchmarkTest` + связанных таблиц.

---

## Схема блоков

```text
┌──────────────────────────┐
│ Benchmark                │
│ suite / контейнер        │
└─────────────┬────────────┘
              │ 1:N
              ▼
┌──────────────────────────┐
│ BenchmarkTest            │
│ карточка каталога        │
└──────┬───────────┬───────┘
       │           │
       │           ├──────────────────────────────────────┐
       │                                                  │
       ▼                                                  ▼
┌─────────────────────┐                         ┌─────────────────────┐
│ Taxonomy tables      │                         │ Content tables       │
│ skills               │                         │ examples             │
│ domains              │                         │ references           │
│ subdomains           │                         │ links                │
│ abilityTaxons        │                         │ subDatasets          │
│ abilityTags          │                         └─────────────────────┘
│ modalities           │
└─────────────────────┘

BenchmarkTest ── N:M ── MetricDefinition
       │
       │ 1:N
       ▼
MetricResult ── N:1 ── Model
```

---

## CatalogModule

### Benchmark

`Benchmark` — это контейнер для нескольких тестов.

Пример:

```text
Benchmark: MMLU-RU
BenchmarkTest:
  - MMLU-RU / Math
  - MMLU-RU / Medicine
  - MMLU-RU / Law
```

В `Benchmark` не храним таксономию, метрики, примеры и ссылки. Они относятся к конкретному `BenchmarkTest`.

### BenchmarkTest

`BenchmarkTest` — основная карточка каталога.

Содержит:

- название и описание;
- инструкцию запуска;
- ссылки на codebase;
- GigaMetrics поля;
- таксономию;
- examples;
- references;
- links;
- subsets;
- связи с MetricDefinition;
- MetricResult для отображения scores.

### Taxonomy

Таксономия хранится отдельными таблицами:

```text
BenchmarkTestSkill
BenchmarkTestAbilityTaxon
BenchmarkTestAbilityTag
BenchmarkTestSubGroup
BenchmarkTestDomain
BenchmarkTestSubdomain
BenchmarkTestModality
BenchmarkTestProjectGroup
BenchmarkTestFeatureLabel
```

На фронт это маппится в массивы:

```ts
skills: string[]
abilityTaxons: string[]
abilityTags: string[]
domains: string[]
subdomains: string[]
modalities: string[]
```

### Links

`BenchmarkLink` используется для ссылок:

```text
obs
gitverse
github
docs
dataset
score_racoon
giga_metrics
other
```

### GigaMetrics

На `BenchmarkTest` лежат поля:

```text
gigaMetricsCodebaseUrl
gigaMetricsAdapterName
gigaMetricsSetUrl
gigaMetricsLaunchCommand
```

На фронт они отдаются как:

```ts
gigaMetricsCodebaseUrl?: string
gigaMetricAdapterName?: string
gigaMetricSetUrl?: string
gigaMetricLaunchCommand?: string
```

---

## MetricsModule

### MetricDefinition

`MetricDefinition` — справочник метрик.

Примеры:

```text
Accuracy
F1
ExactMatch
BLEU
ROUGE
```

Содержит:

- name;
- displayName;
- priority;
- direction;
- min/max/target;
- evaluationLogic;
- requiredGigaChatQualityLevel;
- metadata.

### MetricPriorityLookup

Справочник приоритетов метрик.

Минимальные значения:

```text
primary
secondary
```

### MetricDirectionLookup

Справочник направления метрики.

Минимальные значения:

```text
higher_is_better
lower_is_better
```

### BenchmarkTestMetric

Связь N:M между `BenchmarkTest` и `MetricDefinition`.

Нужна, чтобы карточка каталога знала, какие метрики применимы:

```ts
metrics: ['Accuracy', 'F1']
```

### Model

Модель, которую оцениваем.

Пример:

```text
gigachat-2-pro
gpt-4o
llama-3-70b
```

### MetricResult

Конкретное значение метрики:

```text
modelId + testId + metricId + value
```

Пример:

```text
GigaChat 2 Pro
MMLU-RU / Math
Accuracy
87.34
```

На фронт это превращается в:

```ts
scores: [
  {
    modelId: 'gigachat-2-pro',
    modelName: 'GigaChat 2 Pro',
    score: 87.34,
    isOpenSource: false
  }
]
```

---

## Фронтовый контракт

Текущий фронт ожидает объект `Benchmark`.

Основные поля, которые уже покрывает backend:

```ts
id: string
suiteId?: string
name: string
nameEn: string
description: string
descriptionEn: string
codebase: { name: string; url: string }
metrics: string[]
examples: BenchmarkExample[]
instructions: string
instructionsEn: string
references: { title: string; url: string }[]
macroGroup: string
subGroups: string[]
abilityTaxons: string[]
modality: Modality
taskType: TaskType
domains: string[]
subdomains: string[]
sizeInSamples: number
medianSampleSizeWords: number
requestLengthDist: { min: number; median: number; max: number }
responseLengthDist: { min: number; median: number; max: number }
language: Language
difficulty: Difficulty
fewShot: boolean
rag: boolean
tools: boolean
reasoning: boolean
longContext: boolean
scores: ModelScore[]
subDatasets?: SubDataset[]
gigaMetricAdapterName?: string
gigaMetricSetUrl?: string
gigaMetricLaunchCommand?: string
validationStatus?: 'validation' | 'published' | 'rejected'
isGenerated?: boolean
jiraTicketId?: string
generatedAt?: string
```

Дополнительные backend-поля вроде `links`, `skills`, `abilityTags`, `gigaMetricsCodebaseUrl` не ломают фронт. Их можно постепенно подключать.

---

## Важное ограничение текущего фронта

Dashboard сейчас ожидает один score на модель в рамках benchmark-карточки:

```ts
benchmark.scores.find((s) => s.modelId === modelId)
```

Если backend отдаст несколько scores одной модели по разным метрикам, фронт возьмёт первый.

Поэтому для полной совместимости backend должен отдавать в `scores` только primary score на модель или фронт должен быть доработан под несколько metric scores.

Рекомендуемый backend-вариант для MVP:

```text
scores = latest primary MetricResult per model
```

---

## Ручки

### Catalog

```http
GET    /api/catalog
GET    /api/catalog/filters/options
GET    /api/catalog/:id
POST   /api/catalog
PATCH  /api/catalog/:id
DELETE /api/catalog/:id
```

### Metrics

```http
GET    /api/metrics
POST   /api/metrics
GET    /api/metrics/:id
PATCH  /api/metrics/:id
DELETE /api/metrics/:id

GET    /api/metrics/lookups/priorities
GET    /api/metrics/lookups/directions

POST   /api/metrics/models
GET    /api/metrics/models

POST   /api/metrics/results
GET    /api/metrics/tests/:testId/results
```

---
