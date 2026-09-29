import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WorkTypesController } from './work-types.controller.js';
import type { WorkTypesService } from './work-types.service.js';
import { ROLES } from '../../common/decorators/roles.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

const HANDLERS = ['list', 'bulkCreate', 'update', 'setTeamSelection', 'resync'] as const;
const admin: SessionUser = { id: 'a1', role: 'ADMIN', teamId: 't1' };
const manager: SessionUser = { id: 'm1', role: 'MANAGER', teamId: 't1' };
const employee: SessionUser = { id: 'e1', role: 'EMPLOYEE', teamId: 't1' };

function guardContext(handler: (typeof HANDLERS)[number], user: SessionUser): ExecutionContext {
  return {
    getHandler: () => WorkTypesController.prototype[handler],
    getClass: () => WorkTypesController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function make() {
  const service = {
    list: vi.fn().mockResolvedValue([]),
    bulkCreate: vi.fn(),
    update: vi.fn(),
    setTeamSelection: vi.fn(),
    resync: vi.fn(),
  } as unknown as WorkTypesService;
  return { ctrl: new WorkTypesController(service), service };
}

beforeEach(() => vi.clearAllMocks());

describe('WorkTypesController authorization', () => {
  it.each(HANDLERS)('pins %s to ADMIN', (handler) => {
    expect(Reflect.getMetadata(ROLES, WorkTypesController.prototype[handler])).toEqual(['ADMIN']);
  });

  it.each(HANDLERS)('403s MANAGER and EMPLOYEE on %s through the real RolesGuard', (handler) => {
    const guard = new RolesGuard(new Reflector());
    for (const user of [manager, employee]) {
      expect(() => guard.canActivate(guardContext(handler, user))).toThrow(ForbiddenException);
    }
    expect(guard.canActivate(guardContext(handler, admin))).toBe(true);
  });
});

describe('WorkTypesController delegation', () => {
  it('passes the URL ids, body and actor through', async () => {
    const { ctrl, service } = make();
    await ctrl.bulkCreate({ names: ['A'] }, admin);
    expect(service.bulkCreate).toHaveBeenCalledWith({ names: ['A'] }, admin);
    await ctrl.update('w1', { archived: true }, admin);
    expect(service.update).toHaveBeenCalledWith('w1', { archived: true }, admin);
    await ctrl.setTeamSelection('t2', { workTypeIds: [] }, admin);
    expect(service.setTeamSelection).toHaveBeenCalledWith('t2', { workTypeIds: [] }, admin);
    await ctrl.resync(admin);
    expect(service.resync).toHaveBeenCalledWith(admin);
    await ctrl.list();
    expect(service.list).toHaveBeenCalled();
  });
});
