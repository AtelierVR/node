import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiPasskeyDto {
  @ApiProperty({
    description: 'Internal passkey ID',
    example: 'a1b2c3d4-0000-4000-8000-000000000000',
  })
  id!: string;

  @ApiPropertyOptional({
    type: 'string',
    nullable: true,
    description: 'User-provided label',
    example: 'My laptop',
  })
  name!: string | null;

  @ApiProperty({
    description: 'Single-device or multi-device (synced) credential',
    example: 'multiDevice',
  })
  device_type!: string;

  @ApiProperty({
    description: 'Whether the credential is synced/backed up',
    example: true,
  })
  backed_up!: boolean;

  @ApiProperty({
    description: 'Resident key — usable for usernameless login',
    example: true,
  })
  discoverable!: boolean;

  @ApiProperty({
    type: [String],
    description: 'Authenticator transports',
    example: ['internal', 'hybrid'],
  })
  transports!: string[];

  @ApiProperty({
    description: 'Unix timestamp (ms) of registration',
    example: 1680000000000,
  })
  created_at!: number;

  @ApiPropertyOptional({
    type: 'number',
    nullable: true,
    description: 'Unix timestamp (ms) of last use',
    example: 1680000000000,
  })
  last_used_at!: number | null;
}

export class ApiPasskeyRegistrationOptionsDto {
  @ApiProperty({
    description:
      'Opaque ceremony handle to pass back to /auth/passkey/register/verify',
  })
  ceremony_id!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'PublicKeyCredentialCreationOptionsJSON — feed it to startRegistration()',
  })
  options!: Record<string, unknown>;
}

export class PasskeyFactorCodeDto {
  @ApiProperty({
    description:
      'Single-use 6-digit code to send as `factor_code` on the original request',
    example: '482913',
  })
  factor_code!: string;
}

export class ApiPasskeyAuthenticationOptionsDto {
  @ApiProperty({
    description:
      'Opaque ceremony handle to pass back to /auth/passkey/login/verify',
  })
  ceremony_id!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'PublicKeyCredentialRequestOptionsJSON — feed it to startAuthentication()',
  })
  options!: Record<string, unknown>;
}
