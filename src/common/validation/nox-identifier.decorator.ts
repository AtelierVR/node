import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/**
 * Maximum length accepted for a serialized NoxIdentifier.
 * Full format: [<type>:]<id>[?<key>=<value>[&<key>=<value>]][@<server>]
 */
export const NOX_IDENTIFIER_MAX_LENGTH = 256;

/**
 * Charset allowed inside a NoxIdentifier.
 * Covers the optional `type:` prefix, the id, the `?key=value&…` query and the `@server` suffix.
 * Intentionally rejects whitespace, slashes, quotes and control characters so the value can be
 * safely embedded in URLs, logs and database rows.
 */
const NOX_IDENTIFIER_RE = /^[a-zA-Z0-9_.:@?=&%-]+$/;

/**
 * Validates that a value is a well-formed NoxIdentifier string.
 *
 * @example
 *   @IsNoxIdentifier() world!: string;
 *   @IsNoxIdentifier({ each: true }) contributors?: string[];
 */
export function IsNoxIdentifier(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return function (object: object, propertyName: string | symbol): void {
    registerDecorator({
      name: 'isNoxIdentifier',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return (
            typeof value === 'string' &&
            value.length > 0 &&
            value.length <= NOX_IDENTIFIER_MAX_LENGTH &&
            NOX_IDENTIFIER_RE.test(value)
          );
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be a valid Nox identifier (e.g. "u:42@example.com")`;
        },
      },
    });
  };
}
