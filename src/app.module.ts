import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AnalyticsModule } from '@/analytics/analytics.module';
import { AppController } from '@/app.controller';
import { AppService } from '@/app.service';
import { AuthModule } from '@/auth/auth.module';
import { JwtAuthGuard } from '@/auth/jwt/jwt-auth.guard';
import { CatalogModule } from '@/catalog/catalog.module';
import { OriginCsrfGuard } from '@/common/guards/origin-csrf.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import adminConfig from '@/configs/admin.config';
import agentConfig from '@/configs/agent.config';
import configuration from '@/configs/configuration';
import dbConfig from '@/configs/database.config';
import embeddingConfig from '@/configs/embedding.config';
import kafkaConfig from '@/configs/kafka.config';
import recommendationConfig from '@/configs/recommendation.config';
import vaultConfig from '@/configs/vault.config';
import { ConversationsModule } from '@/conversations/conversations.module';
import { GenerationModule } from '@/generation/generation.module';
import { HealthModule } from '@/health/health.module';
import { HypothesesModule } from '@/hypotheses/hypotheses.module';
import { MetricsModule } from '@/metrics/metrics.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { UsersModule } from '@/users/users.module';
import { ExternalApiModule } from './external-api/external-api.module';
// import redisConfig from '@/configs/redis.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal:true,
      load: [
        configuration,
        dbConfig,
        adminConfig,
        agentConfig,
        vaultConfig,
        embeddingConfig,
        recommendationConfig,
        kafkaConfig,
        // redisConfig,
      ],
      cache: true,
    }),
    UsersModule,
    AuthModule,
    PrismaModule,
    CatalogModule,
    MetricsModule,
    AnalyticsModule,
    ExternalApiModule,
    HypothesesModule,
    HealthModule,
    ConversationsModule,
    GenerationModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: OriginCsrfGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
