import { SetMetadata } from '@nestjs/common';

export const CSRF_EXEMPT_KEY = 'csrfExempt';
export const CsrfExempt = () => SetMetadata(CSRF_EXEMPT_KEY, true);
