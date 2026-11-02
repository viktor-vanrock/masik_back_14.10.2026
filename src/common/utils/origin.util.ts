import type { IncomingHttpHeaders } from 'http';

export type OriginPolicyContext = {
  headers: IncomingHttpHeaders;
  encrypted: boolean;
  nodeEnv: string;
  trustedOrigins: readonly string[];
  originTrustForwardedHeaders: boolean;
};

const headerValue = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export const normalizeOrigin = (value: string): Nullable<string> => {
  try {
    const url = new URL(value);
    const port = url.port || ('https:' === url.protocol ? '443' : '80');
    return `${url.protocol}//${url.hostname.toLowerCase()}:${port}`;
  } catch {
    return null;
  }
};

export const reconstructExpectedOrigin = (context: OriginPolicyContext): Nullable<string> => {
  if (context.originTrustForwardedHeaders) {
    const forwardedProto = headerValue(context.headers['x-forwarded-proto']);
    const forwardedHost = headerValue(context.headers['x-forwarded-host']);

    if (forwardedProto && forwardedHost) {
      return normalizeOrigin(`${forwardedProto}://${forwardedHost}`);
    }
  }

  const host = headerValue(context.headers.host);
  if (!host) {
    return null;
  }

  return normalizeOrigin(`${context.encrypted ? 'https' : 'http'}://${host}`);
};

export const isAllowedOrigin = (
  candidate: string | undefined,
  context: OriginPolicyContext
): boolean => {
  const normalized = candidate ? normalizeOrigin(candidate) : null;
  if (!normalized) {
    return false;
  }

  if (context.trustedOrigins.length > 0) {
    return context.trustedOrigins.some(
      (trusted) => normalizeOrigin(trusted) === normalized
    );
  }

  const expected = reconstructExpectedOrigin(context);
  return expected !== null && normalized === expected;
};
