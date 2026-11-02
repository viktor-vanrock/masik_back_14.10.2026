import { SetMetadata } from '@nestjs/common';
import { EXTERNAL_API_KEY_SCOPES_KEY } from '../external-api-key.constants';

export const ExternalApiScopes = (...scopes: string[]) =>
  SetMetadata(EXTERNAL_API_KEY_SCOPES_KEY, scopes);
