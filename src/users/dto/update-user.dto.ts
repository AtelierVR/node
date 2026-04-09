import { IsArray, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiLinkDto {
    @ApiProperty({ description: 'Link display label', example: 'GitHub' })
    @IsString()
    @IsNotEmpty()
    label!: string;

    @ApiProperty({ description: 'Link URL', example: 'https://github.com/johndoe' })
    @IsString()
    value!: string;
}

export class UpdateUserDto {
    @ApiPropertyOptional({ description: 'New unique username', example: 'johndoe' })
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    username?: string;

    @ApiPropertyOptional({ description: 'New display name', example: 'John Doe' })
    @IsOptional()
    @IsString()
    display?: string;

    @ApiPropertyOptional({ type: 'string', description: 'Biography text, or null to clear', example: 'Full-stack developer', nullable: true })
    @IsOptional()
    @IsString()
    bio?: string | null;

    @ApiPropertyOptional({ type: 'string', description: 'Pronouns, or null to clear', example: 'he/him', nullable: true })
    @IsOptional()
    @IsString()
    pronoun?: string | null;

    @ApiPropertyOptional({ type: 'string', description: 'New email address, or null to remove', example: 'john@example.com', nullable: true })
    @IsOptional()
    @IsString()
    email?: string | null;

    @ApiPropertyOptional({ description: 'Required when changing the password', example: 'oldpassword' })
    @IsOptional()
    @IsString()
    current_password?: string;

    @ApiPropertyOptional({ description: 'New password', example: 'newpassword' })
    @IsOptional()
    @IsString()
    password?: string;

    @ApiPropertyOptional({ type: () => [ApiLinkDto], description: 'External links list, or null to clear', nullable: true })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ApiLinkDto)
    links?: ApiLinkDto[] | null;

    @ApiPropertyOptional({ type: [String], description: 'Tags list, or null to clear', example: ['developer', 'gamer'], nullable: true })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    tags?: string[] | null;

    @ApiPropertyOptional({ type: 'string', description: 'Thumbnail URL, or null to clear', example: null, nullable: true })
    @IsOptional()
    @IsString()
    thumbnail?: string | null;

    @ApiPropertyOptional({ type: 'string', description: 'Banner URL, or null to clear', example: null, nullable: true })
    @IsOptional()
    @IsString()
    banner?: string | null;

    @ApiPropertyOptional({ type: 'string', example: null, nullable: true, description: 'Home world identifier' })
    @IsOptional()
    @IsString()
    home?: string | null;

    @ApiPropertyOptional({ type: 'string', example: null, nullable: true, description: 'Active avatar identifier' })
    @IsOptional()
    @IsString()
    avatar?: string | null;

    @ApiPropertyOptional({ description: 'Presence status: online, busy, do_not_disturb, stream, offline', example: 'online' })
    @IsOptional()
    @IsString()
    presence?: string;

    @ApiPropertyOptional({ type: 'string', description: 'Custom presence status text, or null to clear', example: 'In a meeting', nullable: true })
    @IsOptional()
    @IsString()
    presence_status?: string | null;

    @ApiPropertyOptional({ description: 'TOTP 2FA code — required when enabling/disabling 2FA', example: '123456' })
    @IsOptional()
    @IsString()
    factor_code?: string;
}

