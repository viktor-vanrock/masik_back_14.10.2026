import { randomBytes } from 'node:crypto';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { VaultTransitService } from '@/vault/vault-transit.service';
import { CreateExternalApiKeyDto } from './dto/createExternalApiKeyDto.dto';
import {
  ExternalApiKeyPublicDto,
  ExternalApiKeyResponseDto,
} from './dto/externalApiKeyResponseDto.dto';
import {
  DEFAULT_EXTERNAL_API_KEY_SCOPES,
  EXTERNAL_API_KEY_STATUS,
} from './external-api-key.constants';
import { ValidatedExternalApiKey } from './types/validated-external-api-key.type';

@Injectable()
export class ExternalApiKeysService {
  private readonly API_KEY_PREFIX = 'bcb_';
  private readonly PUBLIC_PREFIX_BYTES = 8;
  private readonly SECRET_BYTES = 32;
  private readonly MAX_PREFIX_GENERATION_ATTEMPTS = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly vaultTransitService: VaultTransitService
  ) {}

  async createApiKey(
    dto: CreateExternalApiKeyDto,
    ownerId: string
  ): Promise<ExternalApiKeyResponseDto> {
    const { apiKey, prefix } = await this.generateUniqueApiKey();
    const hmac = await this.vaultTransitService.createHmac(apiKey);
    const scopes = dto.scopes?.length
      ? dto.scopes
      : DEFAULT_EXTERNAL_API_KEY_SCOPES;

    const created = await this.prisma.externalApiKey.create({
      data: {
        name: dto.name,
        description: dto.description,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        prefix,
        hmac,
        scopes,
        status: EXTERNAL_API_KEY_STATUS.ACTIVE,
        ownerId,
      },
    });

    return {
      id: created.id,
      name: created.name,
      apiKey,
      keyPrefix: created.prefix,
      description: created.description ?? undefined,
      scopes: created.scopes,
      status: created.status,
      owner: created.ownerId ?? undefined,
      expiresAt: created.expiresAt?.toISOString(),
      createdAt: created.createdAt.toISOString(),
    };
  }

  async findAllApiKeys(): Promise<ExternalApiKeyPublicDto[]> {
    const keys = await this.prisma.externalApiKey.findMany({
      select: {
        id: true,
        name: true,
        prefix: true,
        description: true,
        scopes: true,
        status: true,
        ownerId: true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return keys.map((key) => ({
      id: key.id,
      name: key.name,
      keyPrefix: key.prefix,
      description: key.description ?? undefined,
      scopes: key.scopes,
      status: key.status,
      owner: key.ownerId ?? undefined,
      expiresAt: key.expiresAt?.toISOString(),
      revokedAt: key.revokedAt?.toISOString(),
      lastUsedAt: key.lastUsedAt?.toISOString(),
      createdAt: key.createdAt.toISOString(),
    }));
  }

  async revokeApiKey(id: string): Promise<void> {
    const existing = await this.prisma.externalApiKey.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException(
        `External API key with id "${id}" was not found`
      );
    }

    await this.prisma.externalApiKey.update({
      where: { id },
      data: {
        status: EXTERNAL_API_KEY_STATUS.REVOKED,
        revokedAt: new Date(),
      },
    });
  }

  async validateApiKey(
    rawApiKey: string,
    requiredScopes: string[] = []
  ): Promise<ValidatedExternalApiKey> {
    const prefix = this.extractKeyPrefix(rawApiKey);

    if (!prefix) {
      throw new UnauthorizedException('Invalid external API key');
    }

    const candidates = await this.prisma.externalApiKey.findMany({
      select: {
        id: true,
        prefix: true,
        hmac: true,
        scopes: true,
        ownerId: true,
      },
      where: {
        prefix,
        status: EXTERNAL_API_KEY_STATUS.ACTIVE,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
    });

    for (const candidate of candidates) {
      if (!candidate.hmac) {
        continue;
      }

      const isValid = await this.vaultTransitService.verifyHmac(
        rawApiKey,
        candidate.hmac
      );

      if (!isValid) {
        continue;
      }

      const missingScopes = requiredScopes.filter(
        (scope) => !candidate.scopes.includes(scope)
      );

      if (missingScopes.length) {
        throw new ForbiddenException(
          `API key does not have required scopes: ${missingScopes.join(', ')}`
        );
      }

      await this.prisma.externalApiKey.update({
        where: { id: candidate.id },
        data: { lastUsedAt: new Date() },
      });

      return {
        id: candidate.id,
        prefix: candidate.prefix,
        owner: candidate.ownerId,
        scopes: candidate.scopes,
      };
    }

    throw new UnauthorizedException('Invalid external API key');
  }

  private async generateUniqueApiKey(): Promise<{
    apiKey: string;
    prefix: string;
  }> {
    for (
      let attempt = 0;
      attempt < this.MAX_PREFIX_GENERATION_ATTEMPTS;
      attempt += 1
    ) {
      const publicPart = randomBytes(this.PUBLIC_PREFIX_BYTES)
        .toString('hex');
      const prefix = `${this.API_KEY_PREFIX}${publicPart}`;
      const alreadyExists = await this.prisma.externalApiKey.findFirst({
        where: { prefix },
        select: { id: true },
      });

      if (!alreadyExists) {
        const secret = randomBytes(this.SECRET_BYTES)
          .toString('base64url');

        return {
          prefix,
          apiKey: `${prefix}_${secret}`,
        };
      }
    }

    throw new Error('Could not generate a unique API key prefix');
  }

  private extractKeyPrefix(rawApiKey: string): string | null {
    const match = /^((?:bcb_)[a-f0-9]{16})_[A-Za-z0-9_-]{43}$/.exec(
      rawApiKey
    );

    return match?.[1] ?? null;
  }
}
