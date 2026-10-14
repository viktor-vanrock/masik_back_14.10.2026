import { registerAs } from '@nestjs/config';
import { VaultEnvType } from './types';

export default registerAs('vault', (): VaultEnvType => ({
  address: process.env.VAULT_ADDR || 'http://127.0.0.1:8200',
  token: process.env.VAULT_TOKEN || '',
  tokenFile: process.env.VAULT_TOKEN_FILE || '/vault/secrets/token',
  namespace: process.env.VAULT_NAMESPACE || '',
  transitMount: process.env.VAULT_TRANSIT_MOUNT || 'transit',
  hmacKeyName:
    process.env.VAULT_TRANSIT_HMAC_KEY ||
    'benchmark-catalog-external-api',
  timeoutMs: Number(process.env.VAULT_TIMEOUT_MS) || 3000,
}));
