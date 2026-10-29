import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { LeaderboardBoardsController } from './leaderboard-boards.controller';
import { LeaderboardBoardsService } from './leaderboard-boards.service';
@Module({ imports: [PrismaModule], controllers: [LeaderboardBoardsController], providers: [LeaderboardBoardsService] })
export class LeaderboardBoardsModule {}
