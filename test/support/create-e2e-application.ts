import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '@/app.module';
import { configureApplication } from '@/configure-application';

export async function createE2eApplication(): Promise<NestExpressApplication> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication<NestExpressApplication>({
    logger: false,
  });

  configureApplication(app);
  // Keep one loopback listener per suite instead of opening/closing it for each Supertest request.
  await app.listen(0, '127.0.0.1');

  return app;
}
