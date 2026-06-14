import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ServerLogEntryDto {
    @ApiProperty({ description: 'Unix timestamp in milliseconds', example: 1680000000000 })
    timestamp!: number;

    @ApiProperty({ description: 'Log level', example: 'info' })
    level!: string;

    @ApiPropertyOptional({ type: 'string', description: 'Log tag (module name)', example: null, nullable: true })
    tag!: string | null;

    @ApiProperty({ description: 'Log message', example: 'Server started' })
    message!: string;
}

export class ServerLogsResponseDto {
    @ApiProperty({ type: () => [ServerLogEntryDto], description: 'Log entries' })
    items!: ServerLogEntryDto[];

    @ApiProperty({ description: 'Total number of log entries returned', example: 42 })
    total!: number;
}

export class ServerConfigEntryDto {
    @ApiProperty({ description: 'Config key in dot-notation', example: 'app.name' })
    key!: string;

    @ApiPropertyOptional({ type: 'string', description: 'Human-readable label', example: 'Application Name', nullable: true })
    label!: string | null;

    @ApiPropertyOptional({ type: 'string', description: 'Longer description of the config option', example: 'The public display name of this instance.', nullable: true })
    description!: string | null;

    @ApiPropertyOptional({ description: 'Resolved default value (from static config)', example: 'Nox', nullable: true })
    default!: unknown;

    @ApiPropertyOptional({ type: 'string', description: 'Value from environment variable (null if not set)', example: null, nullable: true })
    environment!: string | null;

    @ApiPropertyOptional({ type: 'string', description: 'Value from database override (null if not set)', example: null, nullable: true })
    override!: string | null;

    @ApiProperty({ description: 'Whether the env variable is forced (prefixed with !), preventing DB overrides', example: false })
    forced!: boolean;

    @ApiProperty({ description: 'Whether changing this value may have risky side effects', example: false })
    risky!: boolean;
}

export class ConfigPatchResultItemDto {
    @ApiProperty({ description: 'Config key that was patched', example: 'app.name' })
    key!: string;

    @ApiProperty({ description: 'Whether the patch succeeded', example: true })
    ok!: boolean;

    @ApiPropertyOptional({ type: 'string', description: 'Error message if the patch failed', example: null, nullable: true })
    error?: string;
}

export class ConfigPatchResponseDto {
    @ApiProperty({ type: () => [ConfigPatchResultItemDto], description: 'Per-key patch results' })
    results!: ConfigPatchResultItemDto[];
}

export class InstanceConfigDto {
    @ApiProperty({ description: 'Allow new account registration', example: true })
    allowUserRegistration!: boolean;

    @ApiProperty({ description: 'Allow local users to create world instances', example: true })
    allowInstanceCreation!: boolean;

    @ApiProperty({ description: 'Allow external (federated) users to create world instances', example: false })
    allowInstanceCreationByExternal!: boolean;

    @ApiProperty({ description: 'Allow local users to create worlds', example: true })
    allowWorldCreation!: boolean;

    @ApiProperty({ description: 'Allow external users to create worlds', example: false })
    allowWorldCreationByExternal!: boolean;

    @ApiProperty({ description: 'Allow local users to create avatars', example: true })
    allowAvatarCreation!: boolean;

    @ApiProperty({ description: 'Allow external users to create avatars', example: false })
    allowAvatarCreationByExternal!: boolean;

    @ApiProperty({ description: 'List of available regions', example: ['eu-west', 'us-east'], type: [String] })
    regions!: string[];

    @ApiPropertyOptional({ description: 'Default region pre-selected when creating an instance', example: 'eu-west', nullable: true, type: String })
    defaultRegion!: string | null;

    @ApiProperty({ description: 'Allowed image resize widths (pixels)', example: [64, 128, 256, 512, 1024, 1280, 1920], type: [Number] })
    allowedImageWidths!: number[];
}
