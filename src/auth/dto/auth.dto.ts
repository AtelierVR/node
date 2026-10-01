import { IsEmail, IsNotEmpty, IsOptional, IsString, IsInt, Min, Matches, MinLength, MaxLength, Validate, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsVerificationCode, IsHttpUrl, IsPublicKey } from '../../common/validation';

/**
 * Login identifiers may be a numeric user ID, a username or an email address.
 * A single value constraint keeps the runtime type intact (AuthService switches
 * on `typeof identifier`) while still rejecting objects/arrays/oversized input.
 */
@ValidatorConstraint({ name: 'loginIdentifier', async: false })
class LoginIdentifierConstraint implements ValidatorConstraintInterface {
    validate(value: unknown): boolean {
        if (typeof value === 'number') return Number.isInteger(value) && value >= 1 && value <= 2147483647;
        if (typeof value === 'string') return value.length >= 1 && value.length <= 254;
        return false;
    }
    defaultMessage(): string {
        return 'identifier must be a user ID (positive integer), username or email (max 254 chars)';
    }
}

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
    @MinLength(6)
    @MaxLength(128)
    @IsString()
    @IsNotEmpty()
    password!: string;

    @ApiPropertyOptional({ description: 'Email address for notifications and account recovery', example: 'john@example.com' })
    @MaxLength(254)
    @IsEmail()
    @IsOptional()
    @IsString()
    email?: string;

    @ApiPropertyOptional({ type: 'string', description: 'URL of a pre-existing thumbnail image, or null', example: null, nullable: true })
    @IsHttpUrl()
    @IsOptional()
    @IsString()
    thumbnail?: string;

    @ApiPropertyOptional({ type: 'string', description: 'URL of a pre-existing banner image, or null', example: null, nullable: true })
    @IsHttpUrl()
    @IsOptional()
    @IsString()
    banner?: string;

    @ApiPropertyOptional({ type: 'string', example: null, nullable: true, description: 'Ed25519 public key (base64 SPKI DER)' })
    @IsPublicKey({ type: 'ed25519' })
    @IsOptional()
    @IsString()
    public_key?: string;
}

export class LoginDto {
    @ApiProperty({ example: 'johndoe', description: 'Username, email or numeric user ID', oneOf: [{ type: 'string' }, { type: 'integer' }] })
    @Validate(LoginIdentifierConstraint)
    identifier!: string | number;

    @ApiProperty({ description: 'Account password (6-128 characters)', example: 'secret123' })
    @MinLength(6)
    @MaxLength(128)
    @IsString()
    @IsNotEmpty()
    password!: string;

    @ApiPropertyOptional({ example: null, nullable: true, description: 'Verification code for MFA (6 characters)' })
    @IsVerificationCode()
    @IsOptional()
    @IsString()
    factor_code?: string;

    @ApiPropertyOptional({ example: null, nullable: true, description: 'Ed25519 public key (base64 SPKI DER)' })
    @IsPublicKey({ type: 'ed25519' })
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

/**
 * Body payload accepted by the generic `/auth/methods/:method/{setup,enable,disable}`
 * endpoints. Which field is required depends on the target method, so all fields
 * are optional but strictly validated (type, format and length) when present.
 */
export class AuthMethodPayloadDto {
    @ApiPropertyOptional({ description: 'Email address (email method setup)', example: 'john@example.com' })
    @MaxLength(254)
    @IsEmail()
    @IsOptional()
    @IsString()
    email?: string;

    @ApiPropertyOptional({ description: 'TOTP secret (base32) returned by the setup step (totp method enable)', example: 'JBSWY3DPEHPK3PXP' })
    @MaxLength(128)
    @IsOptional()
    @IsString()
    secret?: string;

    @ApiPropertyOptional({ description: 'One-time code: TOTP code (totp method) or email link token (email method)', example: '123456' })
    @MinLength(6)
    @MaxLength(256)
    @IsOptional()
    @IsString()
    token?: string;

    @ApiPropertyOptional({ description: 'Verification code (6 characters) required to disable a method', example: '123456' })
    @IsVerificationCode()
    @IsOptional()
    @IsString()
    factor_code?: string;
}
