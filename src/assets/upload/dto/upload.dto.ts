import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Body of `PUT /api/:type` — register a new locally-hosted (uploadable) asset. */
export class CreateUploadAssetDto {
  @ApiPropertyOptional({ description: 'Custom numeric asset id. If omitted, one is auto-assigned.', example: 42 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  id?: number;

  @ApiPropertyOptional({ example: 'my-mod', description: 'Unique identifier of the asset within its type: alphanumeric, plus dot, underscore and dash. When omitted, the asset is only addressable by its numeric id.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, {
    message:
      'name must start with an alphanumeric character and only contain [a-zA-Z0-9._-]',
  })
  name?: string;

  @ApiPropertyOptional({ example: 'My Mod', description: 'Display title. Defaults to the name.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({ type: 'string', nullable: true, example: 'A cool mod' })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  description?: string | null;

  @ApiPropertyOptional({ type: [String], example: ['usr:cool'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  tags?: string[];
}

/** Body of `PUT /api/:type/:id/releases` — create a new release to upload files into. */
export class CreateUploadReleaseDto {
  @ApiPropertyOptional({ description: 'Custom numeric release id. If omitted, one is auto-assigned.', example: 7 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  id?: number;

  @ApiPropertyOptional({ example: 'v1.0.0', description: 'Release name/version, unique within the asset. When omitted, the release is only addressable by its numeric id.' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Matches(/^[a-z0-9][a-z0-9._+-]*$/i, {
    message: 'name must be a version-like slug ([a-zA-Z0-9._+-])',
  })
  name?: string;

  @ApiPropertyOptional({ example: 'Initial release' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({ type: 'string', nullable: true, example: 'Changelog…' })
  @IsOptional()
  @IsString()
  @MaxLength(65535)
  changelog?: string | null;

  @ApiPropertyOptional({ enum: ['stable', 'candidate', 'nightly'], default: 'stable' })
  @IsOptional()
  @IsIn(['stable', 'candidate', 'nightly'])
  channel?: 'stable' | 'candidate' | 'nightly';
}

/** A single free-form file attribute, e.g. `platform=windows`, `engine=unity:2022.3.22f1`. Not a Nox tag. */
export class UploadAttributeDto {
  @ApiProperty({ example: 'platform', description: 'Attribute key (e.g. platform, arch, engine).' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  key!: string;

  @ApiProperty({ example: 'windows', description: 'Attribute value. For `engine`, `<engine>[:<version>]`.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  value!: string;
}

/** Body of `POST /api/:type/:id/releases/:releaseId/files` — reserve a file slot and get an upload URL. */
export class InitUploadFileDto {
  @ApiPropertyOptional({ example: 'my-mod-windows.zip', description: 'File name, unique within the release. When omitted, it is derived from the upload `Content-Disposition` filename, or the file is only addressable by its numeric id.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^[^/\\]+$/, { message: 'name must not contain path separators' })
  name?: string;

  @ApiPropertyOptional({ example: 'application/zip', default: 'application/octet-stream', description: 'MIME type. Overridden by the upload `Content-Type` header when present.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  mime?: string;

  @ApiPropertyOptional({
    type: [UploadAttributeDto],
    example: [
      { key: 'platform', value: 'windows' },
      { key: 'arch', value: 'x86_64' },
      { key: 'engine', value: 'unity:2022.3.22f1' },
    ],
    description: 'Free-form file attributes (not Nox tags). Expected keys: platform, arch, engine (value "<engine>[:<version>]"). Used by type-specific validators (avatar/world).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => UploadAttributeDto)
  attributes?: UploadAttributeDto[];
}
/** Body of `PATCH /api/:type/:id` — update asset metadata and preferred release. */
export class UpdateUploadAssetDto {
  @ApiPropertyOptional({ type: 'string', nullable: true, example: 'my-avatar', description: 'New identifier (alphanumeric, plus dot, underscore and dash). Send `null` to clear it (the asset is then only addressable by its numeric id).' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, {
    message:
      'name must start with an alphanumeric character and only contain [a-zA-Z0-9._-]',
  })
  name?: string | null;

  @ApiPropertyOptional({ type: 'string', nullable: true, example: 'My Avatar' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string | null;

  @ApiPropertyOptional({ type: 'string', nullable: true, example: 'A cool avatar' })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  description?: string | null;

  @ApiPropertyOptional({ type: [String], example: ['usr:cool'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({
    type: 'integer',
    nullable: true,
    example: 7,
    description: 'Preferred release id. Send `null` to go back to `auto` (the latest release is then used).',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  release?: number | null;
}

/**
 * Body of `PATCH /api/:type/:id/releases/:version` — update release metadata.
 * Files are **immutable**: they can only be created or deleted, never updated.
 */
export class UpdateUploadReleaseDto {
  @ApiPropertyOptional({ type: 'string', nullable: true, example: '0.2.0', description: 'New release name/version. Send `null` to clear it (the release is then only addressable by its numeric id).' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Matches(/^[a-z0-9][a-z0-9._+-]*$/i, {
    message: 'name must be a version-like slug ([a-zA-Z0-9._+-])',
  })
  name?: string | null;

  @ApiPropertyOptional({ type: 'string', nullable: true, example: 'Initial release' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string | null;

  @ApiPropertyOptional({ type: 'string', nullable: true, example: 'Changelog…' })
  @IsOptional()
  @IsString()
  @MaxLength(65535)
  changelog?: string | null;

  @ApiPropertyOptional({ enum: ['stable', 'candidate', 'nightly'] })
  @IsOptional()
  @IsIn(['stable', 'candidate', 'nightly'])
  channel?: 'stable' | 'candidate' | 'nightly';
}