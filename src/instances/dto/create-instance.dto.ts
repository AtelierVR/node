import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNoxIdentifier, IsNoxName, IsNoxTag, IsHttpUrl } from '../../common/validation';
import { Tags } from '../../common/tags';

export class CreateInstanceDto {
    @ApiProperty({ example: '1@my-server.com', description: 'World identifier (NoxIdentifier format)' })
    @IsNoxIdentifier()
    @IsString()
    @IsNotEmpty()
    world!: string;

    @ApiProperty({ example: 16, description: 'Maximum number of players (0–65535)' })
    @IsInt()
    @Min(0)
    @Max(65535)
    @Type(() => Number)
    capacity!: number;

    @ApiPropertyOptional({ example: 'my-instance', description: 'Short unique slug name (snake_case, 3-8 chars). Left null if omitted.' })
    @IsOptional()
    @IsNoxName()
    @IsString()
    name?: string;

    @ApiPropertyOptional({ description: 'Human-readable instance title', example: 'Chill Hangout' })
    @MaxLength(64)
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    title?: string;

    @ApiPropertyOptional({ type: 'string', example: 'A relaxed instance for socializing', nullable: true })
    @MaxLength(4096)
    @IsOptional()
    @IsString()
    description?: string;

    @ApiPropertyOptional({ type: [String], example: ['usr:social', 'usr:chill'] })
    @ArrayMaxSize(20)
    @IsNoxTag({ each: true, namespaces: [Tags.USER] })
    @IsOptional()
    @IsArray()
    tags?: string[];

    @ApiPropertyOptional({ type: 'string', description: 'ISO 3166-1 alpha-2 region code (lowercase)', example: 'fr' })
    @Matches(/^[a-z]{2}$/, { message: 'Region must be a 2-letter lowercase ISO 3166-1 alpha-2 code' })
    @IsOptional()
    @IsString()
    region?: string;

    @ApiPropertyOptional({ type: 'string', description: 'Thumbnail URL, or null', example: null, nullable: true })
    @IsHttpUrl()
    @IsOptional()
    @IsString()
    thumbnail?: string;

    @ApiPropertyOptional({ description: 'Whether access is restricted to the whitelist', example: false })
    @IsOptional()
    @IsBoolean()
    use_whitelist?: boolean;

    @ApiPropertyOptional({ type: [String], description: 'NoxIdentifier list of allowed users', example: [] })
    @ArrayMaxSize(200)
    @IsNoxIdentifier({ each: true })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    whitelist?: string[];

    @ApiPropertyOptional({ description: 'Whether a password is required to join', example: false })
    @IsOptional()
    @IsBoolean()
    use_password?: boolean;

    @ApiPropertyOptional({ type: 'string', description: 'Join password (min 3 characters), or null', example: null, nullable: true })
    @MinLength(3)
    @MaxLength(128)
    @IsOptional()
    @IsString()
    password?: string;
}
