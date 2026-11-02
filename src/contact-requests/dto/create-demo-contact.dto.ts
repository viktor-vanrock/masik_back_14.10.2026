import { OmitType } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { CreateContactRequestDto } from './create-contact-request.dto';

export class CreateDemoContactDto extends OmitType(CreateContactRequestDto, ['chatId']) {
  @IsUUID('4')
  conversationId: string;
}
