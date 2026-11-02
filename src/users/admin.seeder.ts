import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@/common/enums/role.enum';
import { hashValue } from '@/common/utils/hashValue';
import { AdminUserEnvType } from '@/configs/types';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class AdminSeeder implements OnModuleInit {
  private readonly logger = new Logger(AdminSeeder.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService
  ) {}

  async onModuleInit() {
    const { seedEnabled, username, password, email } =
      this.configService.getOrThrow<AdminUserEnvType>('admin');

    if (!seedEnabled) {
      this.logger.debug('Admin seed skipped: ADMIN_SEED_ENABLED is not true');

      return;
    }

    if (!username || !password || !email) {
      throw new Error(
        'Admin seed enabled, but ADMIN_LOGIN, ADMIN_EMAIL or ADMIN_PASSWORD is not set'
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext('benchmark_catalog_admin_seed')::bigint)
      `;

      const existingSuperUser = await tx.user.findFirst({
        where: {
          role: Role.SuperUser,
        },
      });

      if (existingSuperUser) {
        this.logger.log(
          `SuperUser already exists: id="${existingSuperUser.id}", seed skipped`
        );

        return;
      }

      const existingUser = await tx.user.findUnique({
        where: {
          username,
        },
      });

      if (existingUser) {
        await tx.user.update({
          where: {
            id: existingUser.id,
          },
          data: {
            role: Role.SuperUser,
          },
        });

        this.logger.log(
          `Existing user "${username}" promoted to SuperUser`
        );

        return;
      }

      const passwordHash = await hashValue(password);

      const admin = await tx.user.create({
        data: {
          username,
          email,
          password: passwordHash,
          role: Role.SuperUser,
        },
      });

      this.logger.log(`Seeded SuperUser: id="${admin.id}", username="${username}"`);
    });
  }
}
