import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { Tags } from '../tags';

/**
 * Maximum length accepted for a single tag.
 */
export const NOX_TAG_MAX_LENGTH = 64;

/**
 * Tags follow the `snake_case:snake_case` convention: a lowercase namespace followed by ':'
 * and a lowercase snake_case name. Examples: `usr:pvp`, `usr:can_external_fetch`, `world:night`.
 */
const NOX_TAG_RE = /^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/;

/**
 * Namespaces reserved for the system (see {@link Tags.RESERVED_PREFIXES}).
 * Clients must never be able to set these (e.g. `sys:unlimited`, `sys:admin`),
 * otherwise they could spoof internal flags or grant themselves permissions.
 */
export const RESERVED_TAG_NAMESPACES = Tags.RESERVED_PREFIXES;

export interface IsNoxTagOptions {
  /** If provided, only these namespaces (the part before ':') are accepted. */
  namespaces?: string[];
  /** Allow reserved (`sys:*`) namespaces. Defaults to false. Ignored when `namespaces` is set. */
  allowReserved?: boolean;
}

/**
 * Validates that a value is a tag using the `snake_case:snake_case` convention.
 *
 * By default the reserved (`adm` / `sys` / `dft`) namespaces are rejected. Pass
 * `namespaces: [Tags.USER]` to restrict user-supplied tags to a specific namespace.
 *
 * @example
 *   @IsNoxTag({ namespaces: ['usr'] }) tag!: string;
 *   @IsNoxTag({ each: true, namespaces: ['usr'] }) tags?: string[];
 */
export function IsNoxTag(
  options: IsNoxTagOptions & ValidationOptions = {},
): PropertyDecorator {
  return function (object: object, propertyName: string | symbol): void {
    registerDecorator({
      name: 'isNoxTag',
      target: object.constructor,
      propertyName: propertyName as string,
      options,
      validator: {
        validate(value: unknown): boolean {
          if (
            typeof value !== 'string' ||
            value.length === 0 ||
            value.length > NOX_TAG_MAX_LENGTH ||
            !NOX_TAG_RE.test(value)
          )
            return false;

          const namespace = value.slice(0, value.indexOf(':'));

          if (options.namespaces) return options.namespaces.includes(namespace);

          if (
            !options.allowReserved &&
            Tags.RESERVED_PREFIXES.includes(namespace)
          )
            return false;

          return true;
        },
        defaultMessage(args: ValidationArguments): string {
          if (options.namespaces)
            return `${args.property} must be a tag in the "snake_case:snake_case" format using the ${options.namespaces.map((n) => `"${n}"`).join(' or ')} namespace`;
          return `${args.property} must be a "snake_case:snake_case" tag`;
        },
      },
    });
  };
}
