import { Controller, HttpStatus, Post, Body, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AuthUserGuard, OptionalAuthUserGuard, UserAuthenticatedRequest } from './auth.guard';
import type { OptionalUserAuthenticatedRequest } from './auth.guard';
import { RegisterDto, LoginDto } from './dto/auth.dto';
import type { Request, Response } from 'express';
import { ApiWrappedResponse, ApiWrappedSuccessResponse, ApiErrorResponse } from '../api/swagger';
import { ApiSessionDto } from '../users/dto/user-response.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
    constructor(private readonly auth: AuthService) { }

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
}
