import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Logger } from 'nestjs-pino';

/**
 * PRD §7.2 — errors are RFC 9457 problem+json.
 * Stack traces and Prisma error text NEVER reach the client.
 */
@Catch()
export class ProblemJsonFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<FastifyReply>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      void res.status(status).type('application/problem+json').send(
        typeof body === 'object' ? body : { title: String(body), status },
      );
      return;
    }

    this.logger.error({ err: exception }, 'unhandled exception');
    void res
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .type('application/problem+json')
      .send({
        type: 'https://timetrack.internal/errors/internal',
        title: 'Internal server error',
        status: 500,
      });
  }
}
