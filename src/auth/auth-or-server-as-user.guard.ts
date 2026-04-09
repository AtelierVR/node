import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import type { UserWithMethods } from 'src/users/user.model';
import type { ExternalUserWithMethods } from 'src/external/external-user.model';
import { ApiErrorCode } from 'src/api/api-error.factory';
import { ApiException } from 'src/api/api-exception';
import { OptionalAuthUserGuard, UserAuthenticatedRequest, OptionalUserAuthenticatedRequest } from './auth.guard';
import { OptionalServerAsUserGuard, ServerAsUserAuthenticatedRequest } from './server-as-user.guard';

export type AnyAuthenticatedUser = UserWithMethods | ExternalUserWithMethods;

export interface AnyAuthenticatedRequest {
    user: AnyAuthenticatedUser;
}

export interface OptionalAnyAuthenticatedRequest {
    user: AnyAuthenticatedUser | null;
}

/**
 * Accepts either a locally authenticated user (session/bearer) OR a server-as-user
 * (external server challenge + X-Nox-As header). At least one must succeed.
 * Sets req.user to UserWithMethods | ExternalUserWithMethods; throws UNAUTHORIZED if neither.
 */
@Injectable()
export class AuthOrServerAsUserGuard implements CanActivate {
    constructor(
        private readonly localAuth: OptionalAuthUserGuard,
        private readonly serverAsUser: OptionalServerAsUserGuard,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        await this.localAuth.canActivate(context);
        const req = context.switchToHttp().getRequest<any>();
        if (req.user) return true;

        const ok = await this.serverAsUser.canActivate(context);
        if (!ok) throw new ApiException(ApiErrorCode.UNAUTHORIZED);
        if (!req.user) throw new ApiException(ApiErrorCode.UNAUTHORIZED);
        return true;
    }
}

/**
 * Same as AuthOrServerAsUserGuard but does not throw when unauthenticated —
 * leaves req.user = null instead.
 */
@Injectable()
export class OptionalAuthOrServerAsUserGuard implements CanActivate {
    constructor(
        private readonly localAuth: OptionalAuthUserGuard,
        private readonly serverAsUser: OptionalServerAsUserGuard,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        await this.localAuth.canActivate(context);
        const req = context.switchToHttp().getRequest<any>();
        if (req.user) return true;

        await this.serverAsUser.canActivate(context);
        // req.user is either set or remains null — both are acceptable
        return true;
    }
}
