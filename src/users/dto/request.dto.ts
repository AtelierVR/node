import {
  IsString,
  IsOptional,
  MinLength,
  MaxLength,
  Matches,
  IsEnum,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import type { Type as NestType } from '@nestjs/common';

/**
 * Every accepted `type` for `POST /api/users/:id/request`.
 *
 * Adding a value here forces an entry in {@link REQUEST_DATA_DTO} and
 * {@link REQUEST_EXAMPLES} (both exhaustive `Record<RequestType, …>`), so
 * validation and the generated OpenAPI examples can never silently drift.
 */
export const REQUEST_TYPES = {
  FOLLOW_ACCEPT: 'follow:accept',
  FOLLOW_REJECT: 'follow:reject',
  LOCATION_REQUEST: 'location:request',
  LOCATION_INVITE: 'location:invite',
  PING: 'ping',
} as const;

export type RequestType = (typeof REQUEST_TYPES)[keyof typeof REQUEST_TYPES];

export const LOCATION_EXPIRATION = 24 * 60 * 60 * 1000; // 24 hours

/** Supported `type` values, rendered as a list for the API description. */
export const REQUEST_TYPES_LIST = Object.values(REQUEST_TYPES)
  .map((t) => `\`${t}\``)
  .join(', ');

export class RequestDataDto {}

export class RequestLocationInviteDataDto extends RequestDataDto {
  @ApiPropertyOptional({
    description: 'Instance/location identifier to invite the user to.',
    example: 'i:12@example.com',
    maxLength: 512,
  })
  @IsString()
  @IsOptional()
  location?: string;

  @ApiPropertyOptional({
    description: 'Human-readable label shown with the invite.',
    example: 'Come join us',
    maxLength: 512,
  })
  @IsString()
  @IsOptional()
  @MaxLength(512)
  label?: string;
}

export class RequestLocationRequestDataDto extends RequestDataDto {
  @ApiPropertyOptional({
    description: 'Human-readable label shown with the request.',
    example: 'Where are you?',
    maxLength: 512,
  })
  @IsString()
  @IsOptional()
  @MaxLength(512)
  label?: string;
}

export class RequestFollowDataDto extends RequestDataDto {}

/** Payload of a transient `ping` — pushed to the target's WebSocket only. */
export class RequestPingDataDto extends RequestDataDto {
  @ApiPropertyOptional({
    description: 'Short title of the ping.',
    example: 'Hello!',
    maxLength: 64,
  })
  @IsString()
  @IsOptional()
  @MaxLength(64)
  title?: string;

  @ApiPropertyOptional({
    description: 'Optional body/label of the ping.',
    example: 'ping',
    maxLength: 512,
  })
  @IsString()
  @IsOptional()
  @MaxLength(512)
  label?: string;
}

/**
 * `data` DTO used to validate/transform the payload of each `type`.
 * Exhaustive by construction: a new {@link REQUEST_TYPES} value without an entry
 * here does not compile.
 */
export const REQUEST_DATA_DTO: Record<RequestType, NestType<RequestDataDto>> = {
  [REQUEST_TYPES.FOLLOW_ACCEPT]: RequestFollowDataDto,
  [REQUEST_TYPES.FOLLOW_REJECT]: RequestFollowDataDto,
  [REQUEST_TYPES.LOCATION_REQUEST]: RequestLocationRequestDataDto,
  [REQUEST_TYPES.LOCATION_INVITE]: RequestLocationInviteDataDto,
  [REQUEST_TYPES.PING]: RequestPingDataDto,
};

/** Deduplicated `oneOf` schema listing every possible `data` DTO. */
const REQUEST_DATA_SCHEMAS = [
  ...new Set(Object.values(REQUEST_DATA_DTO)),
].map((dto) => ({ $ref: getSchemaPath(dto) }));

/** A single OpenAPI request example. */
export interface RequestExample {
  summary: string;
  description: string;
  value: { type: RequestType; key?: string; data?: Record<string, unknown> };
}

/**
 * One documented example per request `type` (fed to `@ApiBody({ examples })`).
 * Exhaustive: adding a type without an example does not compile, so the API
 * reference always documents every accepted request.
 */
export const REQUEST_EXAMPLES: Record<RequestType, RequestExample> = {
  [REQUEST_TYPES.FOLLOW_ACCEPT]: {
    summary: REQUEST_TYPES.FOLLOW_ACCEPT,
    description:
      'Accept a pending follow request from `:id`. Returns the resulting relation.',
    value: { type: REQUEST_TYPES.FOLLOW_ACCEPT, key: 'follow:42:7' },
  },
  [REQUEST_TYPES.FOLLOW_REJECT]: {
    summary: REQUEST_TYPES.FOLLOW_REJECT,
    description:
      'Reject a pending follow request from `:id`. Returns the resulting relation.',
    value: { type: REQUEST_TYPES.FOLLOW_REJECT, key: 'follow:42:7' },
  },
  [REQUEST_TYPES.LOCATION_REQUEST]: {
    summary: REQUEST_TYPES.LOCATION_REQUEST,
    description:
      'Ask `:id` to share their location. Persisted (24h) and federated to remote users.',
    value: {
      type: REQUEST_TYPES.LOCATION_REQUEST,
      key: 'loc:42:7',
      data: { label: 'Where are you?' },
    },
  },
  [REQUEST_TYPES.LOCATION_INVITE]: {
    summary: REQUEST_TYPES.LOCATION_INVITE,
    description:
      'Invite `:id` to a location. Persisted (24h) and federated to remote users.',
    value: {
      type: REQUEST_TYPES.LOCATION_INVITE,
      key: 'inv:42:7',
      data: { location: 'i:12@example.com', label: 'Come join us' },
    },
  },
  [REQUEST_TYPES.PING]: {
    summary: REQUEST_TYPES.PING,
    description:
      "Transient notification pushed only to `:id`'s WebSocket clients (never persisted, immediate expiry).",
    value: {
      type: REQUEST_TYPES.PING,
      data: { title: 'Hello!', label: 'ping' },
    },
  },
};

export class RequestDto {
  @ApiProperty({
    enum: REQUEST_TYPES,
    description: `Request type. One of: ${REQUEST_TYPES_LIST}.`,
    example: REQUEST_TYPES.LOCATION_REQUEST,
  })
  @IsEnum(REQUEST_TYPES)
  type!: RequestType;

  @ApiPropertyOptional({
    description:
      'Idempotency key (3–50 characters, lowercase letters, digits, `_` and `:` only).',
    example: 'loc:42:7',
    minLength: 3,
    maxLength: 50,
    pattern: '^[a-z0-9_:]+$',
  })
  @IsString()
  @IsOptional()
  @MinLength(3, { message: 'Key must be at least 3 characters long' })
  @MaxLength(50, { message: 'Key cannot be longer than 50 characters' })
  @Matches(/^[a-z0-9_:]+$/, {
    message: 'Key may only contain lowercase letters, digits, "_" and ":"',
  })
  key?: string;

  @ApiPropertyOptional({
    description:
      'Type-specific payload. Its shape depends on `type` (see the request examples).',
    oneOf: REQUEST_DATA_SCHEMAS,
  })
  @IsOptional()
  @ValidateNested()
  @Type((options) => {
    const parent = options?.object as RequestDto;
    return parent?.type ? REQUEST_DATA_DTO[parent.type] : RequestDataDto;
  })
  data?: RequestDataDto;
}