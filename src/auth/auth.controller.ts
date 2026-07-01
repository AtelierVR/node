import { Controller, HttpStatus, Post, Delete, Body, Req, Res, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { VerificationService } from './verification.service';
import { AuthUserGuard, OptionalAuthUserGuard } from './auth.guard';
import type { OptionalUserAuthenticatedRequest, UserAuthenticatedRequest } from './auth.guard';
import { RegisterDto, LoginDto } from './dto/auth.dto';
import type { Request, Response } from 'express';
import { ApiWrappedResponse, ApiWrappedSuccessResponse, ApiErrorResponse } from '../api/swagger';
import { ApiSessionDto } from '../users/dto/user-response.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
    constructor(
        private readonly auth: AuthService,
        private readonly verification: VerificationService,
    ) { }

    @ApiOperation({ summary: 'Register', description: 'Create a new user account and return a session token.' })
    @ApiWrappedResponse(ApiSessionDto, HttpStatus.CREATED)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.CONFLICT, 'Username or email already taken.')
    @ApiErrorResponse(HttpStatus.UNPROCESSABLE_ENTITY)
    @Post('register')
    async register(@Body() body: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
        const { session, user } = await this.auth.register(body, { ip: req.ip, userAgent: req.get('user-agent') || '' });
        // set cookie
        res.cookie('_uid', session.token, {
            expires: session.expires,
            httpOnly: true,
            sameSite: 'strict',
            secure: false,
        });
        return {
            token: session.token,
            expires: session.expires.getTime(),
            created_at: session.createdAt.getTime(),
            user: await user.sanitizeCurrent()
        };
    }

    @ApiOperation({ summary: 'Login', description: 'Authenticate with credentials and return a session token.' })
    @ApiWrappedResponse(ApiSessionDto, HttpStatus.CREATED)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED, 'Invalid credentials or 2FA required.')
    @ApiErrorResponse(HttpStatus.NOT_FOUND, 'User not found.')
    @ApiErrorResponse(HttpStatus.UNPROCESSABLE_ENTITY, 'Invalid password or factor code.')
    @Post('login')
    async login(@Body() body: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
        const { session, user } = await this.auth.login(body, { ip: req.ip, userAgent: req.get('user-agent') || '' });
        res.cookie('_uid', session.token, {
            expires: session.expires,
            httpOnly: true,
            sameSite: 'strict',
            secure: false,
        });
        return {
            token: session.token,
            expires: session.expires.getTime(),
            created_at: session.createdAt.getTime(),
            user: await user.sanitizeCurrent()
        };
    }

    @ApiOperation({ summary: 'Logout', description: 'Invalidate the current session cookie and bearer token.' })
    @ApiWrappedSuccessResponse(HttpStatus.CREATED)
    @UseGuards(OptionalAuthUserGuard)
    @Post('logout')
    async logout(@Req() req: OptionalUserAuthenticatedRequest, @Res({ passthrough: true }) res: Response): Promise<{ success: boolean }> {
        const success = req.session ? await this.auth.logoutByToken(req.session.token) : false;
        res.clearCookie('_uid');
        return { success };
    }

    // ── Auth Methods (email, totp, etc.) ────────────────────────────────

    @ApiOperation({ summary: 'Send verification code', description: 'Send a 2FA verification code via the requested method.' })
    @UseGuards(AuthUserGuard)
    @Post('methods/:method/send')
    async sendVerificationCode(@Req() req: UserAuthenticatedRequest, @Param('method') method: string) {
        const success = await this.verification.sendFactorCode(req.user, method);
        return { success };
    }

    @ApiOperation({ summary: 'Setup auth method', description: 'Initialize setup for an auth method (e.g. TOTP, email).' })
    @UseGuards(AuthUserGuard)
    @Post('methods/:method/setup')
    async setupMethod(@Req() req: UserAuthenticatedRequest, @Param('method') method: string, @Body() body: any) {
        return this.verification.setupMethod(req.user, method, body);
    }

    @ApiOperation({ summary: 'Enable auth method', description: 'Verify and enable an auth method. Uses optional auth — public for link tokens (e.g. email), authenticated for code-based flows.' })
    @UseGuards(OptionalAuthUserGuard)
    @Post('methods/:method/enable')
    async enableMethod(@Req() req: OptionalUserAuthenticatedRequest, @Param('method') method: string, @Body() body: any) {
        return this.verification.enableMethod(req.user, method, body);
    }

    @ApiOperation({ summary: 'Disable auth method', description: 'Remove an auth method. Requires verification (factor_code).' })
    @UseGuards(AuthUserGuard)
    @Post('methods/:method/disable')
    async disableMethod(@Req() req: UserAuthenticatedRequest, @Param('method') method: string, @Body() body: any) {
        return this.verification.disableMethod(req.user, method, body?.factor_code);
    }
}
