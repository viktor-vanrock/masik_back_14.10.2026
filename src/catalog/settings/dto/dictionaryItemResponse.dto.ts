import { ApiProperty } from '@nestjs/swagger';

export class DictionaryItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  nameEn!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ nullable: true })
  descriptionEn!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'Parent dictionary id (sub-groups → macroGroupId, subdomains → domainId; null for root-level dictionaries)',
  })
  parentId!: string | null;

  @ApiProperty({
    description:
      'Number of active references to this dictionary entry. UI uses this to disable the delete button.',
  })
  usageCount!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class DictionaryListResponseDto {
  @ApiProperty({ type: [DictionaryItemResponseDto] })
  data!: DictionaryItemResponseDto[];

  @ApiProperty()
  total!: number;
}
