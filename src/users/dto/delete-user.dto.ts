import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsVerificationCode } from '../../common/validation';

/**
 * Body accepted by `DELETE /users/@me` (account deletion).
 *
 * `factor_code` proves the account owner approved the irreversible deletion. It is
 * required whenever the account has at least one verification method available:
 * the endpoint first answers `VERIFICATION_REQUIRED`, then the client replays the
 * same request with the code (see the passkey/email/TOTP verification flow).
 */
export class DeleteUserDto {
  @ApiPropertyOptional({
    description:
      'Verification code (TOTP, email or passkey) proving the account owner approved the deletion',
    example: '482913',
  })
  @IsVerificationCode()
  @IsOptional()
  @IsString()
  factor_code?: string;
}
