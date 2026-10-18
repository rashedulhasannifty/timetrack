import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';
import { TimeEntriesController } from './time-entries.controller.js';
import type { TimeEntriesService } from './time-entries.service.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';
import { REQUIRES_MONITORING_ACK } from '../../common/decorators/requires-monitoring-ack.decorator.js';

const user: SessionUser = { id: 'mgr', role: 'MANAGER', teamId: 't1' };

describe('TimeEntriesController', () => {
  it('edit delegates to the service with the id, dto, and current user', async () => {
    const service = {
      edit: vi.fn().mockResolvedValue({ id: 'e1' }),
    } as unknown as TimeEntriesService;
    const controller = new TimeEntriesController(service);
    const dto = { note: 'fixed' };

    await controller.edit('e1', dto, user);

    expect(service.edit).toHaveBeenCalledWith('e1', dto, user);
  });

  it('is NOT monitoring-gated: manual time tracking works before acknowledgement', () => {
    const proto = TimeEntriesController.prototype as unknown as Record<string, object>;
    const handlers = Object.getOwnPropertyNames(proto).filter(
      (k) => k !== 'constructor' && typeof proto[k] === 'function',
    );
    expect(handlers.length).toBeGreaterThan(0);
    for (const h of handlers) {
      expect(Reflect.getMetadata(REQUIRES_MONITORING_ACK, proto[h]!), h).toBeUndefined();
    }
  });
});
