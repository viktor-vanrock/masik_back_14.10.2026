import { IsOptional, IsString, IsUUID } from 'class-validator';

export class StartChatDto {
  @IsOptional()
  @IsString()
  @IsUUID('4')
  conversationId?: string;
}
