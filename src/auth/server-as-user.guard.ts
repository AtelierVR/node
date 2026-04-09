import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { OptionalServerAuthenticatedRequest, ServerAuthenticatedRequest, OptionalServerGuard } from './server.guard';
import { ExternalUserWithMethods } from 'src/external/external-user.model';
import { ExternalUsersService } from 'src/external/external-users.service';
import { ApiErrorCode } from 'src/api/api-error.factory';
import { ApiException } from 'src/api/api-exception';
import { ApiUser } from 'src/users/users.types';

export interface OptionalServerAsUserAuthenticatedRequest extends OptionalServerAuthenticatedRequest {
    user: ExternalUserWithMethods | null;
}

export interface ServerAsUserAuthenticatedRequest extends ServerAuthenticatedRequest {
    user: ExternalUserWithMethods;
}

/** Runs OptionalServerGuard + resolves X-Nox-As user. Sets req.user = null if header absent. */
@Injectable()
export class OptionalServerAsUserGuard implements CanActivate {
    constructor(
        private readonly serverGuard: OptionalServerGuard,
        private readonly externalUsers: ExternalUsersService,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const ok = await this.serverGuard.canActivate(context);
        if (!ok) return false;

        const req = context.switchToHttp().getRequest<OptionalServerAsUserAuthenticatedRequest>();
        if (!req.server) 
            return true;

        req.user = null;

        const rawId = req.get('x-nox-as');
        if (!rawId) return true;

        const id = Number(rawId);
        if (!Number.isInteger(id) || id <= 0) return true;

        let user = await this.externalUsers.findByIid(id, req.server.address as string);
        if (!user) {
            const resp = await req.server.fetch<ApiUser>(`/users/${id}`);
            if (resp.error || !resp.data) return true;
            user = await this.externalUsers.upsertUser(id, req.server, resp.data.public);
        }

        req.user = user;
        return true;
    }
}

/** Requires both a valid Challenge token and a valid X-Nox-As user. */
@Injectable()
export class ServerAsUserGuard implements CanActivate {
    constructor(private readonly optional: OptionalServerAsUserGuard) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        if (!await this.optional.canActivate(context))
            return false;
        const req = context.switchToHttp().getRequest<ServerAsUserAuthenticatedRequest>();
        if (!req.user || !req.server)
            throw new ApiException(ApiErrorCode.UNAUTHORIZED);
        return true;
    }
}

export default ServerAsUserGuard;
