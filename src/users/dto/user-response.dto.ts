import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiAliasDto, ApiLinkResponseDto } from '../../api/dto/shared.dto';

export class ApiUserRelationsDto {
    @ApiPropertyOptional({ type: 'string', description: 'Outgoing relation type from current user to subject, or null', example: 'follow', nullable: true })
    out!: string | null;

    @ApiPropertyOptional({ type: 'string', description: 'Incoming relation type from subject to current user, or null', example: null, nullable: true })
    in!: string | null;
}

export class ApiUserPresenceDto {
    @ApiProperty({ description: 'Presence status — one of: oja, ojf, online, busy, dnd, stream, offline', example: 'online' })
    status!: string;

    @ApiPropertyOptional({ type: 'string', description: 'Custom presence status text, or null', example: null, nullable: true })
    text!: string | null;

    @ApiPropertyOptional({ type: [String], description: 'List of instance iids the user is currently in. null means the viewer has no permission to see this field.', example: [], nullable: true })
    locations!: string[] | null;
}

export class ApiUserDto {
    @ApiProperty({ description: 'Internal numeric user ID', example: 1 })
    id!: number;

    @ApiProperty({ description: 'Unique username (lowercase)', example: 'johndoe' })
    username!: string;

    @ApiProperty({ description: 'Public display name', example: 'John Doe' })
    display!: string;

    @ApiPropertyOptional({ type: 'string', description: 'User biography, or null', example: 'Full-stack developer', nullable: true })
    bio!: string | null;

    @ApiPropertyOptional({ type: 'string', description: 'Pronouns, or null', example: 'he/him', nullable: true })
    pronoun!: string | null;

    @ApiProperty({ description: 'Server hostname this user belongs to', example: 'my-server.com' })
    server!: string;

    @ApiProperty({ description: 'User-defined tags', type: [String], example: [] })
    tags!: string[];

    @ApiPropertyOptional({ type: 'string', description: 'URL to profile thumbnail, or null', example: 'https://cdn.my-server.com/thumb.png', nullable: true })
    thumbnail!: string | null;

    @ApiPropertyOptional({ type: 'string', description: 'URL to profile banner, or null', example: null, nullable: true })
    banner!: string | null;

    @ApiProperty({ description: 'External links', type: () => [ApiLinkResponseDto] })
    links!: ApiLinkResponseDto[];

    @ApiPropertyOptional({ description: 'Relationship to the requesting user, or null if not applicable', type: () => ApiUserRelationsDto, nullable: true })
    relations!: ApiUserRelationsDto | null;

    @ApiProperty({ description: 'Ed25519 public key (base64 SPKI DER)', example: 'MCow...==' })
    public!: string;

    @ApiProperty({ description: 'Number of followers', example: 42 })
    followers!: number;

    @ApiProperty({ description: 'Number of users this user follows', example: 17 })
    following!: number;

    @ApiProperty({ description: 'Current presence status', type: () => ApiUserPresenceDto })
    presence!: ApiUserPresenceDto;

    @ApiProperty({ description: 'Aliases (NoxIdentifier extras)', type: () => [ApiAliasDto] })
    alias!: ApiAliasDto[];
}

export class ApiCurrentUserDto extends ApiUserDto {
    @ApiPropertyOptional({ type: 'string', description: 'Email address, or null', example: 'john@example.com', nullable: true })
    email!: string | null;

    @ApiProperty({ description: 'Whether the email has been verified', example: false })
    email_verified!: boolean;

    @ApiProperty({ description: 'Account creation timestamp (Unix ms)', example: 1680000000000 })
    created_at!: number;

    @ApiPropertyOptional({ type: 'string', description: 'Home world identifier, or null', example: null, nullable: true })
    home!: string | null;

    @ApiPropertyOptional({ type: 'string', description: 'Active avatar identifier, or null', example: null, nullable: true })
    avatar!: string | null;

    @ApiProperty({ description: 'Whether 2FA (TOTP) is enabled', example: false })
    twofa_enabled!: boolean;
}

export class ApiSessionDto {
    @ApiProperty({ description: 'Session bearer token', example: 'tok_abc123' })
    token!: string;

    @ApiProperty({ description: 'Session expiry timestamp (Unix ms)', example: 1712000000000 })
    expires!: number;

    @ApiProperty({ description: 'Session creation timestamp (Unix ms)', example: 1680000000000 })
    created_at!: number;

    @ApiProperty({ description: 'Authenticated user', type: () => ApiCurrentUserDto })
    user!: ApiCurrentUserDto;
}

export class ApiRelationDto {
    @ApiProperty({ description: 'Relation identifier', example: 'rel_1' })
    id!: string;

    @ApiProperty({ description: 'Relation type (follow, request, block)', example: 'follow' })
    type!: string;

    @ApiProperty({ description: 'Target user NoxIdentifier', example: '1@my-server.com' })
    target!: string;

    @ApiProperty({ description: 'Timestamp when the relation was created (Unix ms)', example: 1680000000000 })
    created_at!: number;
}

export class ApiDeviceDto {
    @ApiProperty({ description: 'User-Agent string', example: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...' })
    user_agent!: string;

    @ApiProperty({ description: 'IP address', example: '203.0.113.42' })
    ip!: string;

    @ApiProperty({ description: 'Last seen timestamp (Unix ms)', example: 1712000000000 })
    last_seen!: number;
}

export class ApiSessionListItemDto {
    @ApiProperty({ description: 'Session unique ID', example: 'abc-def-123' })
    id!: string;

    @ApiProperty({ description: 'Whether this is the current request session', example: false })
    current!: boolean;

    @ApiProperty({ description: 'Whether this session has an active WebSocket connection', example: true })
    active!: boolean;

    @ApiPropertyOptional({ type: 'string', description: 'Ed25519 public key (base64 SPKI DER) if provided during login, or null', example: 'MCowBQYDK2VwAyEA...', nullable: true })
    public_key!: string | null;

    @ApiProperty({ description: 'Session expiry timestamp (Unix ms)', example: 1712000000000 })
    expires_at!: number;

    @ApiProperty({ description: 'Session creation timestamp (Unix ms)', example: 1680000000000 })
    created_at!: number;

    @ApiProperty({ description: 'Devices associated with this session', type: () => [ApiDeviceDto] })
    devices!: ApiDeviceDto[];
}

export class ApiSessionListResponseDto {
    @ApiProperty({ description: 'List of sessions', type: () => [ApiSessionListItemDto] })
    sessions!: ApiSessionListItemDto[];

    @ApiProperty({ description: 'Total number of sessions for pagination', example: 5 })
    total!: number;

    @ApiProperty({ description: 'Page size', example: 10 })
    limit!: number;

    @ApiProperty({ description: 'Page offset', example: 0 })
    offset!: number;
}

export class ApiDeleteSessionResponseDto {
    @ApiProperty({ description: 'Whether the deletion succeeded', example: true })
    success!: boolean;

    @ApiProperty({ description: 'Whether the deleted session was the current one (client should log out)', example: false })
    logout!: boolean;
}
