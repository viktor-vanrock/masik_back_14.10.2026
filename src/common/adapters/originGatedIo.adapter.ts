import { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { isAllowedOrigin } from '@/common/utils/origin.util';
import type { ServerOptions } from 'socket.io';

export class OriginGatedIoAdapter extends IoAdapter {
  constructor(private readonly app: INestApplicationContext) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const configService = this.app.get(ConfigService);

    const allowRequest: NonNullable<ServerOptions['allowRequest']> = (req, callback) => {
      const ok = isAllowedOrigin(req.headers.origin, {
        headers: req.headers,
        encrypted: Boolean((req.socket as { encrypted?: boolean }).encrypted),
        nodeEnv: configService.getOrThrow<string>('nodeEnv'),
        trustedOrigins: configService.get<string[]>('trustedOrigins') ?? [],
        originTrustForwardedHeaders:
          configService.get<boolean>('originTrustForwardedHeaders') ?? false,
      });
      callback(ok ? null : 'Origin not allowed', ok);
    };

    return super.createIOServer(port, {
      ...options,
      allowRequest,
    });
  }
}
