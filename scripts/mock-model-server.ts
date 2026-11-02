import { createHash } from 'node:crypto';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';

const port = positiveInteger(process.env.MOCK_ML_PORT, 8_014);
const embeddingDimensions = positiveInteger(
  process.env.MOCK_ML_EMBEDDING_DIMENSIONS,
  4_096
);

const server = createServer((request, response) => {
  void handle(request, response).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    respond(response, 400, { error: { message } });
  });
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(
    `[mock-ml] listening on http://localhost:${port}\n` +
    `[mock-ml] embeddings: POST /v1/embeddings (${embeddingDimensions} values)\n` +
    '[mock-ml] reranker:  POST /v1/rerank\n'
  );
});

async function handle(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  if ('POST' !== request.method) {
    respond(response, 404, { error: { message: 'Not found' } });
    return;
  }

  const body = await readJson(request);
  if ('/v1/embeddings' === request.url) {
    const input = readStringArray(body.input, 'input');
    respond(response, 200, {
      object: 'list',
      data: input.map((text, index) => ({
        object: 'embedding',
        index,
        embedding: vector(text, embeddingDimensions),
      })),
      model: readString(body.model, 'model'),
      usage: { prompt_tokens: 0, total_tokens: 0 },
    });
    return;
  }

  if ('/v1/rerank' === request.url) {
    const query = extract(readString(body.query, 'query'), '<Query>:');
    const documents = readStringArray(body.documents, 'documents');
    const queryTokens = tokenize(query);
    const results = documents
      .map((document, index) => ({
        index,
        relevance_score: lexicalScore(
          queryTokens,
          tokenize(extract(document, '<Document>:'))
        ),
      }))
      .sort(
        (left, right) =>
          right.relevance_score - left.relevance_score ||
          left.index - right.index
      );

    respond(response, 200, {
      id: `rerank-mock-${Date.now()}`,
      model: readString(body.model, 'model'),
      results,
    });
    return;
  }

  respond(response, 404, { error: { message: 'Not found' } });
}

function vector(value: string, dimensions: number): number[] {
  const result: number[] = new Array<number>(dimensions).fill(0);
  for (const token of tokenize(value)) {
    const digest = createHash('sha256').update(token).digest();
    for (let offset = 0; offset < 8; offset += 2) {
      const index = digest.readUInt16BE(offset) % Math.min(dimensions, 1_536);
      const sign = 0 === (digest[offset + 8] ?? 0) % 2 ? 1 : -1;
      result[index] = (result[index] ?? 0) + sign;
    }
  }
  const hasSignal = result.some((item) => 0 !== item);
  if (!hasSignal) result[0] = 1;
  return result;
}

function lexicalScore(
  query: ReadonlySet<string>,
  document: ReadonlySet<string>
): number {
  if (0 === query.size) return 0;
  const matches = [...query].filter((token) => document.has(token)).length;
  return Number((matches / query.size).toFixed(6));
}

function tokenize(value: string): ReadonlySet<string> {
  return new Set(
    value
      .toLocaleLowerCase('ru-RU')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .split(/\s+/)
      .filter((token) => token.length > 1)
  );
}

function extract(value: string, marker: string): string {
  const start = value.indexOf(marker);
  if (start < 0) return value;
  const tail = value.slice(start + marker.length);
  const end = tail.indexOf('<|im_end|>');
  return (end < 0 ? tail : tail.slice(0, end)).trim();
}

async function readJson(
  request: IncomingMessage
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if ('object' !== typeof parsed || null === parsed || Array.isArray(parsed)) {
    throw new Error('JSON body must be an object');
  }
  return parsed as Record<string, unknown>;
}

function readString(value: unknown, field: string): string {
  if ('string' !== typeof value || !value.trim()) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function readStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => 'string' !== typeof item)) {
    throw new Error(`${field} must be an array of strings`);
  }
  return value as string[];
}

function respond(
  response: ServerResponse,
  status: number,
  payload: unknown
): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(payload));
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
