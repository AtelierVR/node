import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Request } from 'express';
import { SessionService } from './session.service';
import { UsersService } from '../users/users.service';
import { ApiException } from '../api/api-exception';
import { ApiErrorCode } from '../api/api-error.factory';
import { SessionModel } from 'src/generated/prisma/models';
import { UserWithMethods } from '../users/user.model';

export interface UserAuthenticatedRequest extends OptionalUserAuthenticatedRequest {
    user: UserWithMethods;
    session: SessionModel;
}

export interface OptionalUserAuthenticatedRequest extends Request {
    user: UserWithMethods | null;
    session: SessionModel | null;
}


/** Same as AuthUserGuard but returns true (with req.user = null) when no token is present. */
@Injectable()
export class OptionalAuthUserGuard implements CanActivate {
    constructor(private readonly moduleRef: ModuleRef) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const sessions = this.moduleRef.get(SessionService, { strict: false });
        const users = this.moduleRef.get(UsersService, { strict: false });

        const req = context.switchToHttp().getRequest<OptionalUserAuthenticatedRequest>();

        const cookieToken = req.cookies?._uid;
        let token: string | undefined = undefined;
        if (cookieToken && typeof cookieToken === 'string')
            token = cookieToken;

        if (!token) {
            const auth = req.get('authorization') || req.headers.authorization;
            if (auth && typeof auth === 'string')
                if (auth.toLowerCase().startsWith('bearer ')) token = auth.slice(7).trim();
                else token = auth;
        }

        req.user = null;
        req.session = null;

        if (!token) return true;

        const session = await sessions.findSessionByToken(token);
        if (!session || new Date(session.expires) < new Date()) return true;

        const user = await users.findById(session.userId);
        if (!user) return true;

        req.user = user;
        req.session = session;
        return true;
    }
}

@Injectable()
export class AuthUserGuard implements CanActivate {
    constructor(private readonly optional: OptionalAuthUserGuard) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        if (!await this.optional.canActivate(context))
            return false;
        const req = context.switchToHttp().getRequest<OptionalUserAuthenticatedRequest>();
        if (!req.user)
            throw new ApiException(ApiErrorCode.UNAUTHORIZED);
        return true;
    }
}