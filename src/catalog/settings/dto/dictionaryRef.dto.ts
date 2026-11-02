import { ApiProperty } from '@nestjs/swagger';

export class DictionaryRefDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  nameEn!: string;
}
