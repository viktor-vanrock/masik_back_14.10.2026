# Локальная проверка рекомендаций

> **Исторический документ.** Содержимое ниже фиксирует прежний этап/план и может описывать монолит, переходные таблицы, будущий Run или уже неактуальные команды. Для работы после разделения используйте [актуальную архитектуру](architecture.md), [локальный запуск](local-development.md) и [тестирование](testing.md). Не воспринимайте этот файл как текущий контракт.

## Самый простой режим

В `.env` оставьте:

```dotenv
EMBEDDING_PROVIDER=mock
RERANKER_PROVIDER=mock
```

Нужен только PostgreSQL с pgvector. После миграций и наполнения каталога
перестройте поисковую проекцию:

```bash
npm run search:reindex
```

Затем запускайте backend и frontend обычным способом. Встроенные моки
детерминированы: embedder делает нормализованный hashed bag-of-words вектор, а
reranker считает пересечение слов и учитывает pgvector score.

## Полный smoke-тест через PostgreSQL

```bash
npm run recommendations:smoke
```

Тест создаёт две опубликованные карточки, индексирует их, выполняет путь
`mock embedder -> pgvector -> mock reranker`, проверяет медицинскую рекомендацию
и удаляет временные данные. Kafka не нужна.

## Проверка настоящего HTTP-контракта на локальном mock server

Terminal 1:

```bash
npm run mock:ml
```

Terminal 2:

```bash
EMBEDDING_PROVIDER=openai-compatible \
EMBEDDING_URL=http://localhost:8014/v1/embeddings \
EMBEDDING_API_KEY=local \
EMBEDDING_MODEL=Qwen/Qwen3-Embedding-8B \
EMBEDDING_SPEC_ID=local-qwen-mock:benchmark-test-document-v1:dim-1536:l2 \
RERANKER_PROVIDER=qwen-compatible \
RERANKER_URL=http://localhost:8014/v1/rerank \
RERANKER_API_KEY=local \
RERANKER_MODEL=Qwen/Qwen3-Reranker-8B \
npm run start:dev
```

Mock endpoint возвращает embedding длины 4096, поэтому здесь проверяется и
реальная логика обрезки до 1536 с последующей L2-нормализацией. Reranker
принимает служебную Qwen3-обёртку и возвращает `index/relevance_score`.

## Переключение на dev/prod модели

Меняются только ENV:

```dotenv
EMBEDDING_PROVIDER=openai-compatible
EMBEDDING_URL=http://10.224.57.128:8004/v1/embeddings
EMBEDDING_API_KEY=<secret>
EMBEDDING_MODEL=Qwen/Qwen3-Embedding-8B
EMBEDDING_SPEC_ID=Qwen-Qwen3-Embedding-8B:benchmark-test-document-v1:dim-1536:l2

RERANKER_PROVIDER=qwen-compatible
RERANKER_URL=http://10.224.142.115:8004/v1/rerank
RERANKER_API_KEY=<secret>
RERANKER_MODEL=Qwen/Qwen3-Reranker-8B
```

После смены `EMBEDDING_SPEC_ID` обязательно выполните `search:reindex`, потому
что старые и новые векторы нельзя смешивать.

Если reranker недоступен и `RERANKER_FALLBACK_TO_VECTOR=true`, пользователь
получит кандидатов в порядке pgvector. Если недоступен embedder, запрос будет
сохранён со статусом `failed`, после чего пользователь сможет повторить поиск.
