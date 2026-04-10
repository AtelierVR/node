
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, from } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { WellKnownService } from 'src/fediverse/well-known.service';
import { ROOT_ONLY_PATHS } from './api.constants';

@Injectable()
export class ApiInterceptor<T> implements NestInterceptor<T, any> {
    private readonly prefix: string;

    constructor(private readonly wellKnown: WellKnownService) {
        this.prefix = process.env.HTTP_PREFIX ?? 'api';
    }

    private isApiRoute(requestPath: string): boolean {
        // Root-only paths (well-known, nodeinfo) are never API routes
        if (ROOT_ONLY_PATHS.some(p => requestPath === `/${p}` || requestPath.startsWith(`/${p}/`))) 
            return false;
        // No prefix → every other route is an API route
        if (!this.prefix) return true;
        return requestPath.startsWith(`/${this.prefix}`);
    }

    intercept(context: ExecutionContext, next: CallHandler<T>): Observable<any> {
        const ctx = context.switchToHttp();
        const request: Request = ctx.getRequest();
        const response: Response = ctx.getResponse();

        return from(Promise.all([
            this.wellKnown.identifier(),
            this.wellKnown.address(),
            this.wellKnown.version,
        ])).pipe(
            switchMap(([id, address, version]) => {
                response.setHeader('X-Nox-Id', id);
                response.setHeader('X-Nox-Version', version);
                response.setHeader('X-Nox-Address', address);

                if (!this.isApiRoute(request.path))
                    return next.handle();

                return next.handle().pipe(
                    map(data => ({
                        data,
                        request: request.originalUrl,
                        time: Date.now(),
                    })),
                );
            }),
        );
    }
}