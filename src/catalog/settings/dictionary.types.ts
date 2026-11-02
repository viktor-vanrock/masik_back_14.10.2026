export type DictionaryItemType = {
  id: string;
  name: string;
  nameEn: string;
  description: string | null;
  descriptionEn: string | null;
  // Parent FK (present only for sub-groups and subdomains; null elsewhere).
  parentId: string | null;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
};

export type DictionaryAggregateItemType = {
  id: string;
  name: string;
  nameEn: string;
  description: string | null;
  descriptionEn: string | null;
};

export type DictionaryAggregateParentScopedItemType =
  DictionaryAggregateItemType & {
    macroGroupId?: string;
    domainId?: string;
  };

export type SettingsAggregateType = {
  taxonomy: {
    macroGroups: DictionaryAggregateItemType[];
    subGroups: DictionaryAggregateParentScopedItemType[];
    abilityTaxons: DictionaryAggregateItemType[];
  };
  parameters: {
    taskTypes: DictionaryAggregateItemType[];
    modalities: DictionaryAggregateItemType[];
    languages: DictionaryAggregateItemType[];
    difficulties: DictionaryAggregateItemType[];
    capabilities: DictionaryAggregateItemType[];
  };
  domains: {
    domains: DictionaryAggregateItemType[];
    subdomains: DictionaryAggregateParentScopedItemType[];
  };
};

export type DictionaryRefType = {
  id: string;
  name: string;
  nameEn: string;
};
