import { ApiProperty } from '@nestjs/swagger';

class AggregateItemBase {
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
}

class AggregateSubGroupDto extends AggregateItemBase {
  @ApiProperty({ format: 'uuid' })
  macroGroupId!: string;
}

class AggregateSubdomainDto extends AggregateItemBase {
  @ApiProperty({ format: 'uuid' })
  domainId!: string;
}

class TaxonomyBlockDto {
  @ApiProperty({ type: [AggregateItemBase] })
  macroGroups!: AggregateItemBase[];

  @ApiProperty({ type: [AggregateSubGroupDto] })
  subGroups!: AggregateSubGroupDto[];

  @ApiProperty({ type: [AggregateItemBase] })
  abilityTaxons!: AggregateItemBase[];
}

class ParametersBlockDto {
  @ApiProperty({ type: [AggregateItemBase] })
  taskTypes!: AggregateItemBase[];

  @ApiProperty({ type: [AggregateItemBase] })
  modalities!: AggregateItemBase[];

  @ApiProperty({ type: [AggregateItemBase] })
  languages!: AggregateItemBase[];

  @ApiProperty({ type: [AggregateItemBase] })
  difficulties!: AggregateItemBase[];

  @ApiProperty({ type: [AggregateItemBase] })
  capabilities!: AggregateItemBase[];
}

class DomainsBlockDto {
  @ApiProperty({ type: [AggregateItemBase] })
  domains!: AggregateItemBase[];

  @ApiProperty({ type: [AggregateSubdomainDto] })
  subdomains!: AggregateSubdomainDto[];
}

export class SettingsAggregateResponseDto {
  @ApiProperty({ type: TaxonomyBlockDto })
  taxonomy!: TaxonomyBlockDto;

  @ApiProperty({ type: ParametersBlockDto })
  parameters!: ParametersBlockDto;

  @ApiProperty({ type: DomainsBlockDto })
  domains!: DomainsBlockDto;
}
