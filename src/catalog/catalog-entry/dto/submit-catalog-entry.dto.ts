import { ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { IsEmpty, IsOptional, IsUUID } from 'class-validator';
import { BenchmarkValidationStatus } from '@/generated/prisma/client';
import { CreateBenchmarkTestDto } from '../../benchmark-test/dto/createBenchmarkTest.dto';

export class SubmitCatalogEntryDto extends OmitType(CreateBenchmarkTestDto, [
  'validationStatus',
] as const) {
  @ApiPropertyOptional({
    type: String,
    enum: BenchmarkValidationStatus,
    readOnly: true,
    description: 'Assigned by the server and cannot be supplied by a submitter.',
  })
  @IsEmpty({ message: 'Catalog submission status is assigned by the server' })
  validationStatus?: never;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    readOnly: true,
    description: 'Taken from the authenticated user and cannot be supplied in the body.',
  })
  @IsEmpty({ message: 'Catalog submission author is assigned by the server' })
  authorId?: never;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Completed create_new Conversation that produced this submission.',
  })
  @IsOptional()
  @IsUUID('4')
  sourceConversationId?: string;
}
