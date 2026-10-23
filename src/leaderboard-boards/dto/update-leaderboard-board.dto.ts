import { PartialType } from '@nestjs/swagger';
import { CreateLeaderboardBoardDto } from './create-leaderboard-board.dto';
export class UpdateLeaderboardBoardDto extends PartialType(CreateLeaderboardBoardDto, { skipNullProperties: false }) {}
