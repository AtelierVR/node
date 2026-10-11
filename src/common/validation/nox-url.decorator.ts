import { applyDecorators } from '@nestjs/common';
import { IsUrl, MaxLength, ValidationOptions } from 'class-validator';

/** Maximum length accepted for a URL field. */
export const URL_MAX_LENGTH = 2048;

/**
 * Validates an HTTP(S) URL using validator.js (`@IsUrl`), replacing the ad-hoc
 * `^https?://…$` regex that was duplicated across DTOs.
 *
 * Options are chosen to stay compatible with the previous permissiveness while
 * being stricter and RFC-correct:
 *  - only `http` / `https` protocols (rejects `javascript:`, `data:`, `file:`, …)
 *  - protocol required
 *  - TLD not required (allows `http://localhost`, IP hosts, internal domains)
 *  - embedded credentials rejected (`https://user:pass@host`)
 *  - bounded to {@link URL_MAX_LENGTH} characters
 *
 * @example
 *   @IsHttpUrl() thumbnail?: string | null;
 */
export function IsHttpUrl(
  validationOptions: ValidationOptions = {},
): PropertyDecorator {
  return applyDecorators(
    MaxLength(URL_MAX_LENGTH),
    IsUrl(
      {
        protocols: ['http', 'https'],
        require_protocol: true,
        require_tld: false,
        disallow_auth: true,
      },
      { message: 'Invalid URL', ...validationOptions },
    ),
  );
}
