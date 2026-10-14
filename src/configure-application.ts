import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { OriginGatedIoAdapter } from '@/common/adapters/originGatedIo.adapter';
import { assertEnvConfig } from '@/configs/assertEnvConfig';
import { assertOriginConfig } from '@/configs/assertOriginConfig';

export type ConfigureApplicationOptions = Readonly<{
  enableShutdownHooks?: boolean;
}>;

/**
 * Applies runtime behavior shared by the production bootstrap and e2e tests.
 * Keeping this in one place prevents the tested HTTP contract from drifting
 * away from the application started by main.ts.
 */
export function configureApplication(
  app: NestExpressApplication,
  options: ConfigureApplicationOptions = {}
): void {
  app.set('query parser', 'extended');
  app.setGlobalPrefix('api');
  // Producer results can contain up to 1000 examples (32 MiB in the job contract).
  app.useBodyParser('json', { limit: '35mb' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    })
  );

  if (options.enableShutdownHooks) {
    app.enableShutdownHooks();
  }

  const configService = app.get(ConfigService);
  assertEnvConfig(configService);
  assertOriginConfig(configService);
  app.useWebSocketAdapter(new OriginGatedIoAdapter(app));
}
