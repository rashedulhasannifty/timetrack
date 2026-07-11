import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * PRD §7.2 — every request carries a requestId. nestjs-pino/pino-http already mints
 * one per request (`req.id`); this interceptor echoes it back on the response so a
 * client (or the dashboard) can correlate a failure with a server log line.
 * Do NOT invent a second correlation id — reuse pino-http's.
 */
@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const res = http.getResponse<FastifyReply>();
    const requestId = String(req.id);
    return next.handle().pipe(tap(() => void res.header('x-request-id', requestId)));
  }
}
