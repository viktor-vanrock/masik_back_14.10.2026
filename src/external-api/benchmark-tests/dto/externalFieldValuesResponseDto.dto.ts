import { ApiProperty } from '@nestjs/swagger';

export class ExternalAvailableFieldsResponseDto {
  @ApiProperty({
    example: ['language', 'difficulty', 'domains', 'skills'],
  })
  fields!: string[];
}

export class ExternalFieldValuesResponseDto {
  @ApiProperty({ example: 'domains' })
  field!: string;

  @ApiProperty({
    example: ['Математика', 'Физика', 'Медицина'],
  })
  values!: Array<string | boolean>;
}
