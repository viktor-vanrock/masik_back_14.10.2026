export type ValidatedExternalApiKey = {
  id: string;
  prefix: string;
  owner: Nullable<string>;
  scopes: string[];
};
