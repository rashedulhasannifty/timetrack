import { describe, it, expect, vi } from 'vitest';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { RequestIdInterceptor } from './request-id.interceptor.js';

describe('RequestIdInterceptor', () => {
  it('echoes pino-http request id back as the x-request-id response header', async () => {
    const header = vi.fn();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ id: 'req-abc' }),
        getResponse: () => ({ header }),
      }),
    } as unknown as ExecutionContext;
    const next: CallHandler = { handle: () => of('payload') };

    const interceptor = new RequestIdInterceptor();
    const result = await new Promise((resolve) =>
      interceptor.intercept(context, next).subscribe((v) => resolve(v)),
    );

    expect(result).toBe('payload');
    expect(header).toHaveBeenCalledWith('x-request-id', 'req-abc');
  });
});
