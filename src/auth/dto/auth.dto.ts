import { IsNotEmpty, IsOptional, IsString, IsInt, Min, Matches, MinLength, MaxLength } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
    @ApiProperty({ description: 'Unique username (lowercase letters, numbers, dots, hyphens, underscores)', example: 'johndoe' })
    @Transform(({ value }) => typeof value === 'string' ? value.toLowerCase().trim() : value)
    @Matches(/^[a-z0-9_.-]{3,16}$/, { message: 'Username must be 3-16 lowercase letters, numbers, dots, hyphens, or underscores' })
    @IsString()
    @IsNotEmpty()
    username!: string;

    @ApiProperty({ description: 'Public display name (defaults to username if omitted)', example: 'John Doe' })
    @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
    @Matches(/^.{3,32}$/, { message: 'Display name must be 3-32 characters' })
    @IsOptional()
    @IsString()
    display?: string;

    @ApiProperty({ description: 'Account password (6-128 characters)', example: 'secret123' })
    @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
    @MinLength(6)
    @MaxLength(128)
    @IsString()
    @IsNotEmpty()
    password!: string;

    @ApiPropertyOptional({ description: 'Email address for notifications and account recovery', example: 'john@example.com' })
    @Matches(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, { message: 'Invalid email address' })
    @IsOptional()
    @IsString()
    email?: string;

    @ApiPropertyOptional({ type: 'string', description: 'URL of a pre-existing thumbnail image, or null', example: null, nullable: true })
    @Matches(/^https?:\/\/[a-zA-Z0-9_.-]+(:[0-9]{1,5})?(\/.*)?$/, { message: 'Invalid URL' })
    @IsOptional()
    @IsString()
    thumbnail?: string;

    @ApiPropertyOptional({ type: 'string', description: 'URL of a pre-existing banner image, or null', example: null, nullable: true })
    @Matches(/^https?:\/\/[a-zA-Z0-9_.-]+(:[0-9]{1,5})?(\/.*)?$/, { message: 'Invalid URL' })
    @IsOptional()
    @IsString()
    banner?: string;

    @ApiPropertyOptional({ type: 'string', example: null, nullable: true, description: 'Ed25519 public key (base64 SPKI DER)' })
    @Matches(/^([A-Za-z0-9+/=\n]+)$/, { message: 'Invalid public key' })
    @IsOptional()
    @IsString()
    public_key?: string;
}

export class LoginDto {
    @ApiProperty({ example: 'johndoe', description: 'Username, email or numeric user ID', oneOf: [{ type: 'string' }, { type: 'integer' }] })
    @IsNotEmpty()
    identifier!: string | number;

    @ApiProperty({ description: 'Account password (6-128 characters)', example: 'secret123' })
    @MinLength(6)
    @MaxLength(128)
    @IsString()
    @IsNotEmpty()
    password!: string;

    @ApiPropertyOptional({ example: null, nullable: true, description: 'TOTP code for 2FA (6 digits)' })
    @Matches(/^[0-9]{6}$/, { message: 'TOTP code must be exactly 6 digits' })
    @IsOptional()
    @IsString()
    factor_code?: string;

    @ApiPropertyOptional({ example: null, nullable: true, description: 'Ed25519 public key (base64 SPKI DER)' })
    @Matches(/^([A-Za-z0-9+/=\n]+)$/, { message: 'Invalid public key' })
    @IsOptional()
    @IsString()
    public_key?: string;
}

export class SendVerificationCodeDto {
    @ApiProperty({ description: 'Numeric user ID to send the verification code to', example: 1 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    target!: number;
}
