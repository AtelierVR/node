import { IsArray, IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateInstanceDto {
    @ApiPropertyOptional({ description: 'New display title', example: 'Updated Title' })
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    title?: string;

    @ApiPropertyOptional({ type: 'string', description: 'Updated description, or null to clear', example: 'Updated description', nullable: true })
    @MaxLength(4096)
    @IsOptional()
    @IsString()
    description?: string;

    @ApiPropertyOptional({ description: 'Maximum number of players (0–65535)', example: 32 })
    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(65535)
    @Type(() => Number)
    capacity?: number;

    @ApiPropertyOptional({ type: [String], description: 'Updated tags list', example: ['social'] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    tags?: string[];

    @ApiPropertyOptional({ type: 'string', description: 'Thumbnail URL, or null to clear', example: null, nullable: true })
    @Matches(/^https?:\/\/[a-zA-Z0-9_.-]+(:[0-9]{1,5})?(\/.*)?$/, { message: 'Invalid URL' })
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

    @ApiPropertyOptional({ type: 'string', description: 'Join password (min 3 characters), or null to clear', example: null, nullable: true })
    @MinLength(3)
    @IsOptional()
    @IsString()
    password?: string;
}
