import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { MessageKind } from '@/generated/prisma/enums';

export class SendMessageDto {
  @IsOptional()
  @IsUUID('4')
  requestId?: string;

  @IsUUID('4')
  conversationId!: string;

  @IsIn([MessageKind.option, MessageKind.text])
  kind!: typeof MessageKind.option | typeof MessageKind.text;

  @IsString()
  value!: string;

  @IsOptional()
  @IsString()
  label?: string;
}
