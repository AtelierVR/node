import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
    @ApiProperty({ description: 'Unique username (letters, numbers, underscores)', example: 'johndoe' })
    @IsString()
    @IsNotEmpty()
    username!: string;

    @ApiProperty({ description: 'Account password (min 8 characters)', example: 'secret123' })
    @IsString()
    @IsNotEmpty()
    password!: string;

    @ApiPropertyOptional({ description: 'Public display name (defaults to username if omitted)', example: 'John Doe' })
    @IsOptional()
    @IsString()
    display?: string;

    @ApiPropertyOptional({ description: 'Email address for notifications and account recovery', example: 'john@example.com' })
    @IsOptional()
    @IsString()
    email?: string;

    @ApiPropertyOptional({ type: 'string', description: 'URL of a pre-existing thumbnail image, or null', example: null, nullable: true })
    @IsOptional()
    @IsString()
    thumbnail?: string;

    @ApiPropertyOptional({ type: 'string', description: 'URL of a pre-existing banner image, or null', example: null, nullable: true })
    @IsOptional()
    @IsString()
    banner?: string;

    @ApiPropertyOptional({ type: 'string', example: null, nullable: true, description: 'Ed25519 public key (base64 SPKI DER)' })
    @IsOptional()
    @IsString()
    public_key?: string;
}

export class LoginDto {
    @ApiProperty({ example: 'johndoe', description: 'Username, email or numeric user ID', oneOf: [{ type: 'string' }, { type: 'integer' }] })
    @IsNotEmpty()
    identifier!: string | number;

    @ApiProperty({ description: 'Account password (min 8 characters)', example: 'secret123' })
    @IsString()
    @IsNotEmpty()
    password!: string;

    @ApiPropertyOptional({ example: null, nullable: true, description: 'TOTP code for 2FA' })
    @IsOptional()
    @IsString()
    factor_code?: string;

    @ApiPropertyOptional({ example: null, nullable: true, description: 'Ed25519 public key (base64 SPKI DER)' })
    @IsOptional()
    @IsString()
    public_key?: string;
}
