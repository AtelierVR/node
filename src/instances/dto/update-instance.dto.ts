import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsHttpUrl, IsNoxIdentifier, IsNoxTag } from '../../common/validation';

export class UpdateInstanceDto {
    @ApiPropertyOptional({ description: 'New display title', example: 'Updated Title' })
    @MaxLength(64)
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

    @ApiPropertyOptional({ type: [String], description: 'Updated tags list', example: ['usr:social'] })
    @ArrayMaxSize(20)
    @IsNoxTag({ each: true, namespaces: ['usr'] })
    @IsOptional()
    @IsArray()
    tags?: string[];

    @ApiPropertyOptional({ type: 'string', description: 'Thumbnail URL, or null to clear', example: null, nullable: true })
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

    @ApiPropertyOptional({ type: 'string', description: 'Join password (min 3 characters), or null to clear', example: null, nullable: true })
    @MinLength(3)
    @MaxLength(128)
    @IsOptional()
    @IsString()
    password?: string;
}
