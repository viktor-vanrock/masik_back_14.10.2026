import { IsOptional, IsUUID } from 'class-validator';

export class ListContactRequestsDto {
  @IsOptional()
  @IsUUID()
  cursor?: string;
}
