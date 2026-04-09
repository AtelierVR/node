import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { AuthUserGuard, UserAuthenticatedRequest } from './auth.guard';
import { ApiException } from '../api/api-exception';
import { ApiErrorCode } from '../api/api-error.factory';

@Injectable()
export class AdminUserGuard implements CanActivate {
  constructor(private readonly authGuard: AuthUserGuard) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // First ensure the request is authenticated using the existing AuthUserGuard
    const ok = await this.authGuard.canActivate(context);
    if (!ok) return false;

    const req = context.switchToHttp().getRequest<UserAuthenticatedRequest>();
    if (!req.user.isAdmin())
      throw new ApiException(ApiErrorCode.UNAUTHORIZED, null, 'admin access required');

    return true;
  }
}
