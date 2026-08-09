import { IsArray, IsNotEmpty, IsOptional, IsString, ValidateNested, Matches, MinLength, MaxLength } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const URL_PATTERN = /^https?:\/\/[a-zA-Z0-9_.-]+(:[0-9]{1,5})?(\/.*)?$/;

export class ApiLinkDto {
    @ApiProperty({ description: 'Link display label', example: 'GitHub' })
    @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
    @MinLength(1)
    @MaxLength(32)
    @IsString()
    @IsNotEmpty()
    label!: string;

    @ApiProperty({ description: 'Link URL', example: 'https://github.com/johndoe' })
    @Matches(URL_PATTERN, { message: 'Invalid URL' })
    @IsString()
    value!: string;
}

export class UpdateUserDto {
    @ApiPropertyOptional({ description: 'New unique username (lowercase letters, numbers, dots, hyphens, underscores)', example: 'johndoe' })
    @Transform(({ value }) => typeof value === 'string' ? value.toLowerCase().trim() : value)
    @Matches(/^[a-z0-9_.-]{3,16}$/, { message: 'Username must be 3-16 lowercase letters, numbers, dots, hyphens, or underscores' })
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    username?: string;

    @ApiPropertyOptional({ description: 'New display name', example: 'John Doe' })
    @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
    @Matches(/^.{3,32}$/, { message: 'Display name must be 3-32 characters' })
    @IsOptional()
    @IsString()
    display?: string;

    @ApiPropertyOptional({ type: 'string', description: 'Biography text, or null to clear', example: 'Full-stack developer', nullable: true })
    @MaxLength(512)
    @IsOptional()
    @IsString()
    bio?: string | null;

    @ApiPropertyOptional({ type: 'string', description: 'Pronouns, or null to clear', example: 'he/him', nullable: true })
    @MaxLength(32)
    @IsOptional()
    @IsString()
    pronoun?: string | null;

    @ApiPropertyOptional({ type: 'string', description: 'New email address, or null to remove', example: 'john@example.com', nullable: true })
    @Matches(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, { message: 'Invalid email address' })
    @IsOptional()
    @IsString()
    email?: string | null;

    @ApiPropertyOptional({ description: 'Required when changing the password', example: 'oldpassword' })
    @MinLength(6)
    @MaxLength(128)
    @IsOptional()
    @IsString()
    current_password?: string;

    @ApiPropertyOptional({ description: 'New password (6-128 characters)', example: 'newpassword' })
    @MinLength(6)
    @MaxLength(128)
    @IsOptional()
    @IsString()
    password?: string;

    @ApiPropertyOptional({ type: () => [ApiLinkDto], description: 'External links list, or null to clear', nullable: true })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ApiLinkDto)
    links?: ApiLinkDto[] | null;

    @ApiPropertyOptional({ type: [String], description: 'Tags list (usr:* format), or null to clear', example: ['usr:developer', 'usr:gamer'], nullable: true })
    @Matches(/^usr:[a-zA-Z0-9_]+$/, { each: true, message: 'Tags must be usr: format (e.g. usr:developer)' })
    @MinLength(5, { each: true })
    @MaxLength(64, { each: true })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    tags?: string[] | null;

    @ApiPropertyOptional({ type: 'string', description: 'Thumbnail URL, or null to clear', example: null, nullable: true })
    @Matches(URL_PATTERN, { message: 'Invalid URL' })
    @IsOptional()
    @IsString()
    thumbnail?: string | null;

    @ApiPropertyOptional({ type: 'string', description: 'Banner URL, or null to clear', example: null, nullable: true })
    @Matches(URL_PATTERN, { message: 'Invalid URL' })
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

    @ApiPropertyOptional({ description: 'Presence status: oja, ojf, online, busy, dnd, stream, offline', example: 'online' })
    @Matches(/^(oja|ojf|online|busy|dnd|stream|offline)$/, { message: 'Invalid presence status' })
    @IsOptional()
    @IsString()
    presence?: string;

    @ApiPropertyOptional({ type: 'string', description: 'Custom presence status text, or null to clear', example: 'In a meeting', nullable: true })
    @MaxLength(128)
    @IsOptional()
    @IsString()
    presence_status?: string | null;

    @ApiPropertyOptional({ description: 'TOTP 2FA code (6 digits), required for sensitive operations', example: '123456' })
    @Matches(/^[0-9]{6}$/, { message: 'TOTP code must be exactly 6 digits' })
    @IsOptional()
    @IsString()
    factor_code?: string;
}

