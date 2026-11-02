import { EnvType } from '@/configs/types';

export default (): EnvType => ({
  nodeEnv: process.env.NODE_ENV?.trim() ?? '',
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || '',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || '',
  jwtAccessExpire: process.env.JWT_ACCESS_EXPIRE || '7d',
  jwtRefreshExpire: process.env.JWT_REFRESH_EXPIRE || '7d',
  trustedOrigins: (process.env.TRUSTED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  originTrustForwardedHeaders: 'true' === process.env.ORIGIN_TRUST_FORWARDED_HEADERS,
});
