import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { ApprovalListQuery, Decision, TimesheetApproval } from '@timetrack/contracts';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';
import { ResourceAccessService } from '../../common/authz/resource-access.service.js';
import { ApprovalsRepository, type ApprovalScope } from './approvals.repository.js';

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly repo: ApprovalsRepository,
    private readonly access: ResourceAccessService,
  ) {}

  private resolveScope(query: ApprovalListQuery, user: SessionUser): ApprovalScope {
    if (user.role === 'EMPLOYEE') return { kind: 'user', userId: user.id };
    if (query.teamId) {
      if (user.role === 'ADMIN') return { kind: 'team', teamId: query.teamId };
      if (user.role === 'MANAGER' && query.teamId === user.teamId)
        return { kind: 'team', teamId: user.teamId };
      throw new ForbiddenException({
        type: 'https://timetrack.internal/errors/forbidden',
        title: 'Not permitted to view this team',
        status: 403,
      });
    }
    if (user.role === 'ADMIN') return { kind: 'all' };
    return { kind: 'team', teamId: user.teamId };
  }

  async list(query: ApprovalListQuery, user: SessionUser): Promise<TimesheetApproval[]> {
    const scope = this.resolveScope(query, user);
    return this.repo.list(scope, query.status);
  }

  async decide(id: string, dto: Decision, user: SessionUser): Promise<TimesheetApproval> {
    const ts = await this.repo.findById(id);
    if (!ts) {
      throw new NotFoundException({
        type: 'https://timetrack.internal/errors/not-found',
        title: 'Timesheet not found',
        status: 404,
      });
    }
    await this.access.assertCanAccessUser(user, ts.userId); // throws 403
    const totalSeconds = await this.repo.periodTrackedSeconds(
      ts.userId,
      ts.periodStart,
      ts.periodEnd,
    );
    return this.repo.decide(id, {
      status: dto.status,
      note: dto.note ?? null,
      reviewerId: user.id,
      totalSeconds,
      prevStatus: ts.status,
    });
  }
}
