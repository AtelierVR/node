
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, from } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { WellKnownService } from 'src/fediverse/well-known.service';

@Injectable()
export class ApiInterceptor<T> implements NestInterceptor<T, any> {
    constructor(private readonly wellKnown: WellKnownService) { }

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

                if (!request.path.startsWith('/api'))
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