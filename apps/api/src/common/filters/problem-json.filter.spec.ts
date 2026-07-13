import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import type { Logger } from 'nestjs-pino';
import { ProblemJsonFilter } from './problem-json.filter.js';

function make() {
  const send = vi.fn();
  const type = vi.fn().mockReturnValue({ send });
  const status = vi.fn().mockReturnValue({ type });
  const res = { status, type, send };
  const host = {
    switchToHttp: () => ({ getResponse: () => res }),
  } as unknown as ArgumentsHost;
  const logger = { error: vi.fn() } as unknown as Logger;
  return { filter: new ProblemJsonFilter(logger), host, status, type, send, logger };
}

describe('ProblemJsonFilter', () => {
  it('passes through an HttpException object body as problem+json', () => {
    const { filter, host, status, type, send } = make();
    const body = { type: 't', title: 'Nope', status: 400 };
    filter.catch(new BadRequestException(body), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(type).toHaveBeenCalledWith('application/problem+json');
    expect(send).toHaveBeenCalledWith(body);
  });

  it('wraps an HttpException string body into a problem+json shape', () => {
    const { filter, host, status, send } = make();
    filter.catch(new HttpException('teapot', HttpStatus.I_AM_A_TEAPOT), host);

    expect(status).toHaveBeenCalledWith(418);
    expect(send).toHaveBeenCalledWith({ title: 'teapot', status: 418 });
  });

  it('maps an unknown exception to 500 and logs it, never leaking details', () => {
    const { filter, host, status, send, logger } = make();
    const boom = new Error('DB password is hunter2');
    filter.catch(boom, host);

    expect(status).toHaveBeenCalledWith(500);
    expect(logger.error).toHaveBeenCalledWith({ err: boom }, 'unhandled exception');
    const sent = send.mock.calls[0]![0] as { status: number; title: string };
    expect(sent.status).toBe(500);
    expect(sent.title).toBe('Internal server error');
    expect(JSON.stringify(sent)).not.toContain('hunter2');
  });
});
