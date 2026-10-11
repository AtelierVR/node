import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { PasskeyService } from './passkey.service';
import { AuthService } from './auth.service';
import { VerificationService } from './verification.service';
import { AuthUserGuard } from './auth.guard';
import type { UserAuthenticatedRequest } from './auth.guard';
import {
  PasskeyDeleteDto,
  PasskeyFactorVerifyDto,
  PasskeyLoginOptionsDto,
  PasskeyLoginVerifyDto,
  PasskeyRegisterVerifyDto,
  PasskeyRenameDto,
} from './dto/passkey.dto';
import {
  ApiPasskeyDto,
  ApiPasskeyAuthenticationOptionsDto,
  ApiPasskeyRegistrationOptionsDto,
  PasskeyFactorCodeDto,
} from './dto/passkey-response.dto';
import {
  ApiWrappedResponse,
  ApiWrappedArrayResponse,
  ApiWrappedSuccessResponse,
  ApiErrorResponse,
} from '../api/swagger';
import { ApiSessionDto } from '../users/dto/user-response.dto';
import { ApiException } from '../api/api-exception';
import { ApiErrorCode } from '../api/api-error.factory';
import { UsersService } from '../users/users.service';

/**
 * Passkey (WebAuthn) endpoints.
 *
 * All ceremonies are two round-trips: an `options` call returns a challenge plus
 * an opaque `ceremony_id`, the browser runs the ceremony, then the matching
 * `verify` call consumes the challenge (single-use) and checks the signature.
 */
@ApiTags('Auth')
@Controller('auth/passkey')
export class PasskeyController {
  constructor(
    private readonly passkeys: PasskeyService,
    private readonly auth: AuthService,
    private readonly verification: VerificationService,
    private readonly users: UsersService,
  ) {}

  // ── Management ───────────────────────────────────────────────────────────────

  @ApiOperation({
    summary: 'List passkeys',
    description: 'Return the passkeys registered on the authenticated account.',
  })
  @ApiWrappedArrayResponse(ApiPasskeyDto)
  @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
  @UseGuards(AuthUserGuard)
  @Get()
  async list(@Req() req: UserAuthenticatedRequest) {
    return this.passkeys.list(req.user.id);
  }

  @ApiOperation({
    summary: 'Rename passkey',
    description:
      "Change the label of one of the authenticated account's passkeys.",
  })
  @ApiWrappedResponse(ApiPasskeyDto)
  @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
  @ApiErrorResponse(HttpStatus.NOT_FOUND)
  @UseGuards(AuthUserGuard)
  @Patch(':id')
  async rename(
    @Req() req: UserAuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: PasskeyRenameDto,
  ) {
    const updated = await this.passkeys.rename(
      req.user.id,
      id,
      body.name ?? null,
    );
    if (!updated)
      throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Passkey');
    return updated;
  }

  @ApiOperation({
    summary: 'Delete passkey',
    description:
      "Remove one of the authenticated account's passkeys. Requires verification (factor_code) because it is a security-sensitive action.",
  })
  @ApiWrappedSuccessResponse(HttpStatus.OK)
  @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
  @ApiErrorResponse(HttpStatus.NOT_FOUND)
  @ApiErrorResponse(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'Verification required or invalid factor code.',
  )
  @UseGuards(AuthUserGuard)
  @Delete(':id')
  async remove(
    @Req() req: UserAuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: PasskeyDeleteDto,
  ) {
    // Security-sensitive: require a fresh verification (email code, TOTP or passkey).
    if (await this.verification.isVerificationRequired(req.user)) {
      if (body.factor_code) {
        const verifyResult = await this.verification.verifyFactorCode(
          req.user,
          body.factor_code,
        );
        if (!verifyResult.success)
          throw new ApiException(
            ApiErrorCode.VALIDATION_ERROR,
            { field: 'factor_code', message: verifyResult.message },
            verifyResult.message,
          );
      } else {
        const methods = await this.verification.getAvailableVerificationMethods(
          req.user,
        );
        throw new ApiException(
          ApiErrorCode.VERIFICATION_REQUIRED,
          { verification_required: true, methods },
          'Verification required',
        );
      }
    }

    const deleted = await this.passkeys.remove(req.user.id, id);
    if (!deleted)
      throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Passkey');
    return { success: true };
  }

  // ── Registration ─────────────────────────────────────────────────────────────

  @ApiOperation({
    summary: 'Start passkey registration',
    description:
      'Return the creation options (challenge) to feed into navigator.credentials.create().',
  })
  @ApiWrappedResponse(ApiPasskeyRegistrationOptionsDto)
  @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
  @UseGuards(AuthUserGuard)
  @Post('register/options')
  async registerOptions(@Req() req: UserAuthenticatedRequest) {
    return this.passkeys.registrationOptions(req.user);
  }

  @ApiOperation({
    summary: 'Finish passkey registration',
    description: 'Verify the attestation and store the new credential.',
  })
  @ApiWrappedResponse(ApiPasskeyDto, HttpStatus.CREATED)
  @ApiErrorResponse(HttpStatus.BAD_REQUEST)
  @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
  @ApiErrorResponse(HttpStatus.CONFLICT, 'This passkey is already registered.')
  @UseGuards(AuthUserGuard)
  @Post('register/verify')
  async registerVerify(
    @Req() req: UserAuthenticatedRequest,
    @Body() body: PasskeyRegisterVerifyDto,
  ) {
    return this.passkeys.verifyRegistration(
      req.user,
      body.ceremony_id,
      body.response,
      body.name,
    );
  }

  // ── Authentication ───────────────────────────────────────────────────────────

  @ApiOperation({
    summary: 'Start passkey login',
    description:
      'Return the request options (challenge). Provide an identifier to restrict the ceremony to one account, or omit it for a usernameless (discoverable credential) login.',
  })
  @ApiWrappedResponse(ApiPasskeyAuthenticationOptionsDto)
  @ApiErrorResponse(HttpStatus.NOT_FOUND)
  @Post('login/options')
  async loginOptions(@Body() body: PasskeyLoginOptionsDto) {
    const identifier = body.identifier?.trim();
    const user = identifier ? await this.resolveUser(identifier) : null;
    if (identifier && !user)
      throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'User');
    return this.passkeys.authenticationOptions(user);
  }

  @ApiOperation({
    summary: 'Finish passkey login',
    description: 'Verify the assertion and return a session token.',
  })
  @ApiWrappedResponse(ApiSessionDto, HttpStatus.CREATED)
  @ApiErrorResponse(HttpStatus.BAD_REQUEST)
  @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
  @ApiErrorResponse(HttpStatus.NOT_FOUND)
  @Post('login/verify')
  async loginVerify(
    @Body() body: PasskeyLoginVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { userId } = await this.passkeys.verifyAuthentication(
      body.ceremony_id,
      body.response,
    );

    const user = await this.users.findById(userId);
    if (!user) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'User');

    const session = await this.auth.issueSession(
      user,
      { ip: req.ip, userAgent: req.get('user-agent') || '' },
      body.public_key ?? null,
    );

    res.cookie('_uid', session.token, {
      expires: session.expires,
      httpOnly: true,
      sameSite: 'strict',
      secure: false,
    });

    this.users.activity
      .create({
        type: 'auth.passkey_login',
        message: `User "${user.username}" logged in with a passkey`,
        details: { user_id: user.id, session_id: session.id },
        author: `u:${user.id}@::`,
      })
      .catch(() => {});

    return {
      token: session.token,
      expires: session.expires.getTime(),
      created_at: session.createdAt.getTime(),
      user: await user.sanitizeCurrent(),
    };
  }

  @ApiOperation({
    summary: 'Verify a passkey assertion as a 2FA factor',
    description:
      'Run after /auth/passkey/login/options. Verifies the assertion belongs to the authenticated account and returns a single-use 6-digit `factor_code` to pass on the original request.',
  })
  @ApiWrappedResponse(PasskeyFactorCodeDto)
  @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
  @UseGuards(AuthUserGuard)
  @Post('verify')
  async verifyFactor(
    @Req() req: UserAuthenticatedRequest,
    @Body() body: PasskeyFactorVerifyDto,
  ) {
    await this.passkeys.verifyAssertionForUser(
      req.user.id,
      body.ceremony_id,
      body.response,
    );
    return {
      factor_code: await this.verification.issuePasskeyCode(req.user.id),
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /** Resolves a login identifier (username, email or numeric id) to a user. */
  private async resolveUser(identifier: string) {
    if (/^\d+$/.test(identifier))
      return this.users.findById(parseInt(identifier, 10));

    return (
      (await this.users.findByUsername(identifier)) ??
      (identifier.includes('@')
        ? await this.users.findByEmail(identifier)
        : null)
    );
  }
}
