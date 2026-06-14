import { IsArray, IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateInstanceDto {
    @ApiProperty({ example: '1@my-server.com', description: 'World identifier (NoxIdentifier format)' })
    @IsString()
    @IsNotEmpty()
    world!: string;

    @ApiProperty({ example: 16, description: 'Maximum number of players (0–65535)' })
    @IsInt()
    @Min(0)
    @Max(65535)
    @Type(() => Number)
    capacity!: number;

    @ApiPropertyOptional({ example: 'my-instance', description: 'Short unique slug name [a-z0-9-_.]{3,8}. Left null if omitted.' })
    @IsOptional()
    @IsString()
    @Matches(/^[a-z0-9\-_.]{3,8}$/, { message: 'name must be 3-8 characters: lowercase letters, digits, hyphens, underscores, or dots' })
    name?: string;

    @ApiPropertyOptional({ description: 'Human-readable instance title', example: 'Chill Hangout' })
    @IsOptional()
    @IsString()
    title?: string;

    @ApiPropertyOptional({ type: 'string', example: 'A relaxed instance for socializing', nullable: true })
    @IsOptional()
    @IsString()
    description?: string;

    @ApiPropertyOptional({ type: [String], example: ['social', 'chill'] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    tags?: string[];

    @ApiPropertyOptional({ type: 'string', description: 'ISO 3166-1 alpha-2 region code (lowercase), e.g. "fr"', example: 'fr' })
    @IsOptional()
    @IsString()
    region?: string;

    @ApiPropertyOptional({ type: 'string', description: 'Thumbnail URL, or null', example: null, nullable: true })
    @IsOptional()
    @IsString()
    thumbnail?: string;

    @ApiPropertyOptional({ description: 'Whether access is restricted to the whitelist', example: false })
    @IsOptional()
    @IsBoolean()
    use_whitelist?: boolean;

    @ApiPropertyOptional({ type: [String], description: 'NoxIdentifier list of allowed users', example: [] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    whitelist_refs?: string[];

    @ApiPropertyOptional({ description: 'Whether a password is required to join', example: false })
    @IsOptional()
    @IsBoolean()
    use_password?: boolean;

    @ApiPropertyOptional({ type: 'string', description: 'Join password, or null', example: null, nullable: true })
    @IsOptional()
    @IsString()
    password?: string;
}
