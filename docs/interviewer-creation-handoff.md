# Interviewer: единый разговор, поиск и создание бенчмарка

## Граница ответственности

Catalogue подключает Interviewer при открытии любого чата. Пользовательский
текст всегда отправляется агенту: агент отвечает на сообщение, при необходимости
уточняет задачу и предлагает найти готовый тест или создать свой. Поиск и запуск
изобретателя выполняются только через инструменты агента. Embeddings и pgvector
остаются в Catalogue.

Каждый `reject_recommendation` отправляется в тот же разговор как
`recommendation_rejected`, даже если другие карточки ещё доступны. Выбор карточки
также передаётся агенту и сохраняет возможность продолжать чат. Действие
`start_benchmark_creation` добавляет сообщение «Хочу создать свой бенчмарк.».

На один conversation Catalogue открывает отдельное WebSocket-соединение.
URL и Bearer-ключ задаются через `THIRD_PARTY_WS_URL` и
`THIRD_PARTY_API_KEY`.

## Catalogue -> Interviewer

Первое сообщение на новом соединении и повторно после reconnect:

```json
{
  "type": "init",
  "conversationId": "conversation-uuid",
  "intent": null,
  "history": [
    {
      "role": "user",
      "content": {
        "kind": "text",
        "label": "Нужен бенчмарк для генерации кода"
      }
    },
    {
      "role": "user",
      "content": {
        "kind": "recommendation_rejected",
        "benchmarkId": "real-catalogue-benchmark-test-id"
      }
    }
  ]
}
```

Обычный текст пользователя:

```json
{
  "type": "message",
  "content": {
    "kind": "text",
    "label": "Нужен мультимодальный датасет"
  }
}
```

Выбор варианта:

```json
{
  "type": "message",
  "content": {
    "kind": "option",
    "id": "multimodal",
    "label": "Multimodal"
  }
}
```

`history` может также содержать предыдущие agent `text/question/recommendations/result` и ответы
пользователя. После сетевого reconnect Catalogue сначала повторно отправляет
актуальный `init`, а затем накопленные сообщения.

Каждый элемент сохранённой истории включает `id` сообщения. Factory может
передавать стабильный UUID `eventId` в исходящем payload; Catalogue использует
его как Message ID и сохраняет повторную доставку через upsert без дубликатов.
При обрыве между карточками и последующим текстом Factory сравнивает outbox
с ID в `init.history` и повторяет только недоставленные части ответа.
Транспорт добавляет `id=eventId` в reconnect history только после успешного
сохранения сообщения в БД: получение WebSocket frame само по себе не считается
подтверждением доставки.

## Interviewer -> Catalogue

Обычный ответ чатбота:

```json
{
  "type": "message",
  "isFinal": false,
  "content": { "kind": "text", "label": "Могу найти готовый тест или помочь создать свой." }
}
```

Карточки, выбранные агентом после вызова `search_benchmarks`:

```json
{
  "type": "recommendations",
  "isFinal": false,
  "content": {
    "kind": "recommendations",
    "label": "Нашёл тесты для вашей задачи.",
    "benchmarks": [
      { "benchmarkId": "real-catalogue-test-id", "explanation": "Проверяет нужные навыки." }
    ]
  }
}
```

Catalogue сохраняет обычный ответ как agent `text`, а рекомендации — как agent
`text` с `options={"kind":"recommendations","benchmarks":[...]}` и настоящие
сущности `Recommendation`. Browser получает прежнее событие `recommendation_result`
с `requestId`, равным ID сохранённого сообщения, `label`, карточками и объяснениями.
Поиск через инструмент не создаёт отдельный `RecommendationRequest`.

Внутри Catalogue и в Browser API идентификатор теста называется `testId`:
сохранённые `options.benchmarks` и `explanations` содержат `testId`. Только на
границе Factory WS транспорт переводит его в совместимое имя `benchmarkId`,
в том числе во вложенных карточках истории. Это ID теста, а не родительского
Benchmark. Порядок карточек соответствует порядку, выбранному агентом.

Вопрос со свободным вводом:

```json
{
  "type": "question",
  "isFinal": false,
  "content": {
    "kind": "question",
    "label": "Опишите формат входных данных",
    "options": null
  }
}
```

Вопрос с вариантами:

```json
{
  "type": "question",
  "isFinal": false,
  "content": {
    "kind": "question",
    "label": "Какой домен вас интересует?",
    "options": [
      { "id": "nlp", "label": "NLP" },
      { "id": "cv", "label": "CV" }
    ]
  }
}
```

Финальный текст/ТЗ:

```json
{
  "type": "result",
  "isFinal": true,
  "content": {
    "kind": "result",
    "label": "Сформирован черновик нового бенчмарка: ...",
    "status": "done"
  }
}
```

`content.benchmarkId` опционален. Его можно передавать только если Interviewer
действительно создал сущность в Catalogue и возвращает её настоящий ID. Для
текстового ТЗ поле нужно опустить. Catalogue сохраняет result и показывает `label`
обычным сообщением. Ответ или карточка не закрывают разговор.

## Транспорт

- JSON text frames;
- стандартные WebSocket ping/pong должны поддерживаться;
- Bearer header передаётся, только если задан ключ;
- `message`, `question`, `recommendations` и `result` сохраняют активный WS;
- сообщения разрешены и во время генерации; повторный запуск предотвращает
  сохранённый контекст агента и уникальный creator job на conversation;
- `error` передаётся на фронт без завершения conversation;
- повторные/невалидные payload не должны приводить к созданию дубликатов на
  стороне Interviewer.

## Долговременный контекст агента

Поисковый инструмент вызывает `POST /api/internal/v1/interviewer/benchmark-tests/search-agent`
с Bearer-токеном и `{"query":"...","top_k":3}`. Ответ содержит `retrieval_version`
и `candidates` с полями `benchmark_id`, `benchmark_description`, `score`,
`source_updated_at`. Описание — поисковый документ с названием и характеристиками
реального теста. Маршрут использует текущий `retrieve` с точным векторным поиском
в pgvector; legacy `/search` сохраняет прежний контракт и алгоритм.

`GET` и `PUT /api/internal/v1/interviewer/conversations/:conversationId/agent-context`
требуют межсервисный Bearer-токен (`THIRD_PARTY_API_KEY`, совпадающий с
`SERVICE_AUTH_TOKEN` Factory). PUT принимает `{"context": {...}}`; обе операции
возвращают `{"context": object|null}`. Неизвестный conversation возвращает 404,
некорректный UUID/необъектный context — 400, context свыше 1 MiB — 413.

Factory хранит нативную историю сообщений модели, связанные `tool_calls` и
`tool`-ответы, requirements, состояние готовности Brief и ID генерации. Context
сохраняется до/после инструментов и восстанавливается при reconnect. Catalogue
хранит объект в `conversations.agent_context`; публичные ответы истории чата
не включают его. Требуется миграция `20261006090000_interviewer_agent_context`.

`generate_benchmark` использует прежний durable creator-job endpoint. При
принятии валидного Brief Catalogue атомарно устанавливает `intent=create_new` и
`status=generating`, в том числе для разговоров с прежним `find_existing` или
пустым intent. Уникальность задания на conversation защищает от повторной
генерации после reconnect.
