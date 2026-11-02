import { IDictionaryHandler } from './handlers/dictionary-handler.interface';


export const DICTIONARY_TYPE_BY_CATEGORY = {
  taxonomy: ['macro-groups', 'sub-groups', 'ability-taxons'],
  parameters: ['task-types', 'modalities', 'languages', 'difficulties', 'capabilities'],
  domains: ['domains', 'subdomains'],
} as const;

export type DictionaryCategorySlug = keyof typeof DICTIONARY_TYPE_BY_CATEGORY;

export type DictionaryTypeFor<C extends DictionaryCategorySlug> =
  (typeof DICTIONARY_TYPE_BY_CATEGORY)[C][number];

export type DictionaryHandlerMap = {
  [C in DictionaryCategorySlug]: {
    [T in DictionaryTypeFor<C>]: IDictionaryHandler;
  };
};

export const PARENT_SCOPED_PAIRS = new Set<string>([
  'taxonomy/sub-groups',
  'domains/subdomains',
]);

export const ALL_DICTIONARY_TYPE_SLUGS = Object.values(
  DICTIONARY_TYPE_BY_CATEGORY
).flat();

export const DICTIONARY_CATEGORY_SLUGS = Object.keys(
  DICTIONARY_TYPE_BY_CATEGORY
) as DictionaryCategorySlug[];
