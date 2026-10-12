import {
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';
import { ApiAliasDto } from '@/api/dto/shared.dto';
import {
  PROCESS_STATUSES,
  type IAnalysed,
  type IApiStatus,
  type ProcessStatus,
} from '@/assets/asset.types';
import type { IApiAlias } from '@/common/alias.types';
import type { ApiUrl } from '@/common/urls.types';

/**
 * Shape of `IApiFile` for the OpenAPI reference.
 *
 * These classes only describe the payloads returned by the file routes: the
 * files are built by the asset providers, not by a validated request DTO, so
 * there is no `class-validator` usage here.
 */

/** A URL proxified through this instance (`?full=1`). */
export class ApiProxifiedUrlDto {
  @ApiProperty({
    description: 'URL served by this instance (proxified).',
    example: 'https://example.com/api/mods/42/releases/7/files/101',
  })
  proxified!: string;

  @ApiProperty({
    description: 'Original URL, before proxification (provider storage or host).',
    example: 'https://github.com/…/releases/download/v1.0.0/my-mod.zip',
  })
  original!: string;
}

/** Steps of the current run of a file process. */
export class ApiFileStatusProgressDto {
  @ApiProperty({
    description: 'Steps already processed.',
    example: 45,
  })
  current!: number;

  @ApiProperty({
    description: 'Steps to process in total.',
    example: 227,
  })
  total!: number;
}

/** Full status of a file process. */
export class ApiFileStatusDto {
  @ApiProperty({
    description: 'Lifecycle status of the file.',
    enum: [...PROCESS_STATUSES],
    example: 'processing',
  })
  status!: ProcessStatus;

  @ApiPropertyOptional({
    type: () => ApiFileStatusProgressDto,
    nullable: true,
    description:
      'Steps of the current run, or null while they cannot be estimated (nothing counted yet, or the provider reports no steps).',
  })
  progress!: ApiFileStatusProgressDto | null;

  @ApiPropertyOptional({
    type: 'string',
    nullable: true,
    description: 'Human-readable detail about the current step, or null.',
    example: 'Scanning 227 objects',
  })
  message!: string | null;
}

/** API-facing representation of an asset file (`IApiFile`). */
@ApiExtraModels(ApiProxifiedUrlDto, ApiFileStatusDto)
export class ApiFileDto {
  @ApiProperty({
    description:
      'Numeric file id — the last segment of the upload/download URL. The status route accepts it, or the file name instead.',
    example: 101,
  })
  id!: number;

  @ApiProperty({
    type: 'string',
    nullable: true,
    description: 'File name, or null when the slot is unnamed.',
    example: 'my-mod-windows.zip',
  })
  name!: string | null;

  @ApiProperty({
    description:
      'Final download URL, or the temporary upload URL while the upload is pending. `{ proxified, original }` when the response is expanded with `?full=1`.',
    oneOf: [
      { type: 'string', example: 'https://…/files/101' },
      { $ref: getSchemaPath(ApiProxifiedUrlDto) },
    ],
  })
  url!: ApiUrl;

  @ApiProperty({
    type: () => [ApiAliasDto],
    description: 'Aliases of the file (e.g. the `api` URL). Empty when none.',
  })
  alias!: IApiAlias[];

  @ApiProperty({
    description: 'File size in bytes (0 until the bytes have been received).',
    example: 12345678,
  })
  size!: number;

  @ApiProperty({
    description: 'MIME type.',
    example: 'application/zip',
  })
  mime!: string;

  @ApiProperty({
    type: [String],
    description: 'Content hashes (`algo:digest`); empty until computed.',
    example: ['sha256:…'],
  })
  hashs!: string[];

  @ApiProperty({
    description: 'NoxIdentifier string (or numeric id) of the uploader.',
    oneOf: [
      { type: 'string', example: '1@example.com' },
      { type: 'integer', example: 1 },
    ],
  })
  uploader!: string | number;

  @ApiProperty({
    description:
      'Processing status: the shorthand status string, or the full status object while the process has details to report.',
    oneOf: [
      { type: 'string', enum: [...PROCESS_STATUSES], example: 'completed' },
      { $ref: getSchemaPath(ApiFileStatusDto) },
    ],
  })
  status!: IApiStatus;

  @ApiProperty({
    type: () => [ApiAliasDto],
    description:
      'Free-form attributes (e.g. `engine`, `platform`, `arch`); empty when none.',
    example: [{ key: 'platform', value: 'windows' }],
  })
  attributes!: IApiAlias[];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description:
      'Result of the type-specific analysis/validation, or null when there is none. Its content depends on the analyzer of the file type (engine, platform, validator metrics…), so it is deliberately not fixed.',
  })
  analysis!: IAnalysed | null;

  @ApiProperty({
    type: 'number',
    description: 'Creation timestamp (epoch ms). Always set.',
    example: 1789340000000,
  })
  created_at!: number;

  @ApiProperty({
    type: 'number',
    description: 'Last update timestamp (epoch ms). Always set.',
    example: 1789340060000,
  })
  updated_at!: number;

  @ApiProperty({
    type: 'string',
    nullable: true,
    description: 'Detached signature over the file hash (e.g. `ed25519:…`), or null.',
    example: 'ed25519:MEQCIG9X…',
  })
  signature!: string | null;

  @ApiPropertyOptional({
    type: 'number',
    description:
      'Expiration timestamp (epoch ms) of a retryable resource: present while an `awaiting` slot waits for its bytes, and on a `failed` file (its retry window). Omitted for `queued`, `processing` and `completed`.',
    example: 1789340000000,
  })
  expires_at?: number;

  @ApiPropertyOptional({
    type: 'number',
    description:
      'Epoch ms after which the client should GET the file again while it is still changing. Omitted once the file is stable (completed or failed) — like `expires_at`.',
    example: 1789340300000,
  })
  refetch_at?: number;
}

/** Paginated files of a release (`GET …/releases/{version}/files`). */
export class ApiFileListDto {
  @ApiProperty({
    type: 'string',
    nullable: true,
    description: 'Echoed `?query=` filter (matches the file name or MIME), or null.',
    example: null,
  })
  query!: string | null;

  @ApiProperty({
    description: 'Page size (1–100).',
    example: 20,
  })
  limit!: number;

  @ApiProperty({
    description: 'Page start index.',
    example: 0,
  })
  offset!: number;

  @ApiProperty({
    description: 'Full match count, ignoring pagination.',
    example: 3,
  })
  total!: number;

  @ApiProperty({
    type: () => [ApiFileDto],
    description: 'Page of matching files.',
  })
  items!: ApiFileDto[];
}
