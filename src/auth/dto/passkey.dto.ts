import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { IsPublicKey, IsVerificationCode } from '../../common/validation';

/** Opaque handle returned when a ceremony is started, echoed back to finish it. */
const CEREMONY_ID_LENGTH = 36; // uuid v4

export class PasskeyRegisterVerifyDto {
  @ApiProperty({
    description: 'Ceremony handle returned by /auth/passkey/register/options',
  })
  @Length(CEREMONY_ID_LENGTH, CEREMONY_ID_LENGTH)
  @IsString()
  @IsNotEmpty()
  ceremony_id!: string;

  @ApiPropertyOptional({
    description: 'User-friendly label for the new passkey',
    example: 'My laptop',
  })
  @MaxLength(64)
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({
    description:
      'RegistrationResponseJSON produced by @simplewebauthn/browser startRegistration()',
  })
  @IsObject()
  response!: RegistrationResponseJSON;
}

export class PasskeyLoginOptionsDto {
  @ApiPropertyOptional({
    description:
      'Username, email or numeric user ID. Omit to let the browser offer any discoverable passkey (usernameless login).',
    example: 'johndoe',
  })
  @MaxLength(254)
  @IsString()
  @IsOptional()
  identifier?: string;
}

export class PasskeyLoginVerifyDto {
  @ApiProperty({
    description: 'Ceremony handle returned by /auth/passkey/login/options',
  })
  @Length(CEREMONY_ID_LENGTH, CEREMONY_ID_LENGTH)
  @IsString()
  @IsNotEmpty()
  ceremony_id!: string;

  @ApiProperty({
    description:
      'AuthenticationResponseJSON produced by @simplewebauthn/browser startAuthentication()',
  })
  @IsObject()
  response!: AuthenticationResponseJSON;

  @ApiPropertyOptional({
    type: 'string',
    example: null,
    nullable: true,
    description:
      'Public key (base64 SPKI DER, Ed25519 or RSA) binding the session to a device key',
  })
  @IsPublicKey({ type: ['ed25519', 'rsa'] })
  @IsOptional()
  @IsString()
  public_key?: string;
}

export class PasskeyFactorVerifyDto {
  @ApiProperty({
    description: 'Ceremony handle returned by /auth/passkey/login/options',
  })
  @Length(CEREMONY_ID_LENGTH, CEREMONY_ID_LENGTH)
  @IsString()
  @IsNotEmpty()
  ceremony_id!: string;

  @ApiProperty({
    description:
      'AuthenticationResponseJSON produced by @simplewebauthn/browser startAuthentication()',
  })
  @IsObject()
  response!: AuthenticationResponseJSON;
}

export class PasskeyRenameDto {
  @ApiPropertyOptional({
    type: 'string',
    example: null,
    nullable: true,
    description: 'New label, or null to clear it',
  })
  @MaxLength(64)
  @IsString()
  @IsOptional()
  name?: string | null;
}

export class PasskeyDeleteDto {
  @ApiPropertyOptional({
    description:
      'Verification code (TOTP, email or passkey) proving the account owner approved this removal',
    example: '482913',
  })
  @IsVerificationCode()
  @IsOptional()
  @IsString()
  factor_code?: string;
}
