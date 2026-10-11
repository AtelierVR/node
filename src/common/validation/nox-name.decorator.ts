import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/** Short unique names are 3–8 characters. */
export const NOX_NAME_MIN_LENGTH = 3;
export const NOX_NAME_MAX_LENGTH = 8;

/**
 * Short unique names use the snake_case convention: lowercase letters/digits
 * separated by single underscores. No leading/trailing or doubled underscores.
 * Examples: `my_avatar`, `world_01`.
 */
const NOX_NAME_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

/**
 * Validates that a value is a snake_case short name.
 *
 * @example
 *   @IsNoxName() name?: string;
 */
export function IsNoxName(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return function (object: object, propertyName: string | symbol): void {
    registerDecorator({
      name: 'isNoxName',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return (
            typeof value === 'string' &&
            value.length >= NOX_NAME_MIN_LENGTH &&
            value.length <= NOX_NAME_MAX_LENGTH &&
            NOX_NAME_RE.test(value)
          );
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be a snake_case name (${NOX_NAME_MIN_LENGTH}-${NOX_NAME_MAX_LENGTH} chars: lowercase letters, digits and single underscores)`;
        },
      },
    });
  };
}
