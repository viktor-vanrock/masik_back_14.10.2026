import { readFile } from 'node:fs/promises';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VaultHmacResponse, VaultVerifyResponse, VaultResponse } from './types';

@Injectable()
export class VaultTransitService {
  private readonly logger = new Logger(VaultTransitService.name);

  constructor(private readonly configService: ConfigService) {}

  async createHmac(value: string): Promise<string> {
    const response = await this.request<VaultHmacResponse>(
      this.buildTransitPath('hmac'),
      {
        input: this.toBase64(value),
      }
    );

    if (!response.hmac) {
      this.logger.error('Vault Transit did not return an HMAC');
      throw new ServiceUnavailableException(
        'API key cryptographic service is unavailable'
      );
    }

    return response.hmac;
  }

  async verifyHmac(value: string, hmac: string): Promise<boolean> {
    const response = await this.request<VaultVerifyResponse>(
      this.buildTransitPath('verify'),
      {
        input: this.toBase64(value),
        hmac,
      }
    );

    return true === response.valid;
  }

  private async request<T>(
    path: string,
    body: Record<string, string>
  ): Promise<T> {
    const token = await this.getVaultToken();
    const address = this.configService
      .getOrThrow<string>('vault.address')
      .replace(/\/$/, '');
    const timeoutMs = this.configService
      .getOrThrow<number>('vault.timeoutMs');
    const namespace = this.configService.get<string>('vault.namespace');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Vault-Token': token,
    };

    if (namespace) {
      headers['X-Vault-Namespace'] = namespace;
    }

    let response: globalThis.Response;

    try {
      response = await fetch(`${address}/v1/${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      this.logger.error(
        `Vault Transit request failed: ${this.errorMessage(error)}`
      );
      throw new ServiceUnavailableException(
        'API key cryptographic service is unavailable'
      );
    }

    const payload = await this.readResponse<T>(response);

    if (!response.ok || !payload.data) {
      const details = payload.errors?.join('; ') ||
        `HTTP ${response.status}`;
      this.logger.error(`Vault Transit rejected request: ${details}`);
      throw new ServiceUnavailableException(
        'API key cryptographic service is unavailable'
      );
    }

    return payload.data;
  }

  private async readResponse<T>(
    response: globalThis.Response
  ): Promise<VaultResponse<T>> {
    try {
      return await response.json() as VaultResponse<T>;
    } catch {
      return {};
    }
  }

  private buildTransitPath(operation: 'hmac' | 'verify'): string {
    const mount = this.configService
      .getOrThrow<string>('vault.transitMount')
      .replace(/^\/+|\/+$/g, '');
    const keyName = encodeURIComponent(
      this.configService.getOrThrow<string>('vault.hmacKeyName')
    );

    return `${mount}/${operation}/${keyName}/sha2-256`;
  }

  private async getVaultToken(): Promise<string> {
    const tokenFromEnvironment = this.configService
      .get<string>('vault.token')
      ?.trim();

    if (tokenFromEnvironment) {
      return tokenFromEnvironment;
    }

    const tokenFile = this.configService
      .getOrThrow<string>('vault.tokenFile');

    try {
      const token = (await readFile(tokenFile, 'utf8')).trim();

      if (token) {
        return token;
      }
    } catch (error) {
      this.logger.error(
        `Cannot read Vault token file "${tokenFile}": ${this.errorMessage(error)}`
      );
    }

    throw new ServiceUnavailableException(
      'API key cryptographic service is unavailable'
    );
  }

  private toBase64(value: string): string {
    return Buffer.from(value, 'utf8').toString('base64');
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
