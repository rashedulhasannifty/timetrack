import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TeamSettingsSchema } from '@timetrack/contracts';
import type {
  AuditLogPage,
  AuditLogQuery,
  EraseUser,
  ObservedApps,
  TeamSettings,
  UpdateSettings,
} from '@timetrack/contracts';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';
import { MinioService } from '../../infra/storage/minio.service.js';
import { AdminRepository } from './admin.repository.js';

@Injectable()
export class AdminService {
  constructor(
    private readonly repo: AdminRepository,
    private readonly storage: MinioService,
  ) {}

  listAudit(query: AuditLogQuery): Promise<AuditLogPage> {
    return this.repo.listAudit(query);
  }

  /** App names the actor's team has actually reported recently, for the settings picker. */
  async listObservedApps(actor: SessionUser): Promise<ObservedApps> {
    const appNames = await this.repo.listObservedApps(actor.teamId);
    return { appNames };
  }

  async updateSettings(patch: UpdateSettings, actor: SessionUser): Promise<TeamSettings> {
    // Normalize the stored value (fills defaults for a legacy/partial row)...
    const current = TeamSettingsSchema.parse(await this.repo.getSettings(actor.teamId));
    // ...merge, then validate the MERGED object so what we persist is always complete & in-range.
    const merged = TeamSettingsSchema.parse({ ...current, ...patch });
    await this.repo.writeSettings(
      actor.teamId,
      merged,
      { before: current, after: merged },
      actor.id,
    );
    return merged;
  }

  /**
   * PRD §4.4 — right to erasure. ORDER IS THE COMPLIANCE PROPERTY:
   * guards → last-admin PRE-CHECK → S3 prefix sweep → one DB transaction. Object keys are
   * derivable from the userId (`raw/<id>/`, `thumb/<id>/`), so the sweep needs no DB read and is
   * idempotent. Any S3 failure throws here, before a single row changes — a row must never be
   * dropped while its object could survive (the rule slice 4.1 established). The pre-check is a
   * cheap, non-locking read that refuses BEFORE touching S3 for the common (non-racing) case; the
   * repository's `FOR UPDATE` re-check inside the transaction remains the authoritative, race-safe
   * guard and stays unchanged. The user's REAL email is captured before the transaction, because
   * `invites` is keyed by email, not userId.
   */
  async eraseUser(userId: string, dto: EraseUser, actor: SessionUser): Promise<void> {
    const target = await this.repo.findForErase(userId);
    if (!target) {
      throw new NotFoundException({
        type: 'https://timetrack.internal/errors/not-found',
        title: 'User not found',
        status: 404,
      });
    }
    if (target.teamId !== actor.teamId) {
      throw new ForbiddenException({
        type: 'https://timetrack.internal/errors/forbidden',
        title: 'Cannot manage a user in another team',
        status: 403,
      });
    }
    if (target.id === actor.id) {
      throw new ConflictException({
        type: 'https://timetrack.internal/errors/conflict',
        title: 'You cannot erase your own account',
        status: 409,
      });
    }

    // Last-admin PRE-CHECK (cheap read) — refuse BEFORE touching S3. The repository's FOR UPDATE
    // re-check remains the authoritative, race-safe guard for the LAST_ADMIN case below.
    if (target.role === 'ADMIN' && target.deactivatedAt === null) {
      const activeAdmins = await this.repo.countActiveAdmins(target.teamId);
      if (activeAdmins <= 1) {
        throw new ConflictException({
          type: 'https://timetrack.internal/errors/conflict',
          title: 'Cannot erase the last active admin',
          status: 409,
        });
      }
    }

    // Objects first — abort the whole erase if any delete fails.
    const deletedObjects =
      (await this.storage.deleteByPrefix(`raw/${userId}/`)) +
      (await this.storage.deleteByPrefix(`thumb/${userId}/`));

    const result = await this.repo.eraseUser(
      userId,
      target.email,
      actor.id,
      dto.reason,
      deletedObjects,
    );
    if (result.status === 'LAST_ADMIN') {
      throw new ConflictException({
        type: 'https://timetrack.internal/errors/conflict',
        title: 'Cannot erase the last active admin',
        status: 409,
      });
    }
  }

  /**
   * PRD §4.4 — a full data export for one user, streamed as JSON. Same guards as erase (404 /
   * cross-team 403). Emits the envelope incrementally and delegates each table to a paged
   * repository generator, so a user with tens of thousands of activity samples is never
   * materialized in memory. `refresh_tokens` is deliberately excluded — `tokenHash` is live
   * session material, not personal data.
   */
  async exportUser(userId: string, actor: SessionUser): Promise<AsyncIterable<string>> {
    const target = await this.repo.findForErase(userId);
    if (!target) {
      throw new NotFoundException({
        type: 'https://timetrack.internal/errors/not-found',
        title: 'User not found',
        status: 404,
      });
    }
    if (target.teamId !== actor.teamId) {
      throw new ForbiddenException({
        type: 'https://timetrack.internal/errors/forbidden',
        title: 'Cannot manage a user in another team',
        status: 403,
      });
    }
    return this.generateExport(userId, target.email);
  }

  /**
   * `email` is threaded through separately from `userId`: `invites` is keyed by email (not
   * userId), so `streamInvites` needs the target's real address, which only the guard read in
   * `exportUser` has.
   */
  private async *generateExport(userId: string, email: string): AsyncGenerator<string> {
    const header = await this.repo.exportUserHeader(userId);
    yield `{"exportedAt":${JSON.stringify(new Date().toISOString())},"user":${JSON.stringify(header)}`;

    const sections: [string, AsyncGenerator<unknown>][] = [
      ['timeEntries', this.repo.streamTimeEntries(userId)],
      ['timesheetApprovals', this.repo.streamTimesheetApprovals(userId)],
      ['activitySamples', this.repo.streamActivitySamples(userId)],
      ['activityDailySummaries', this.repo.streamActivityDailySummaries(userId)],
      ['screenshots', this.repo.streamScreenshots(userId)],
      ['idleEvents', this.repo.streamIdleEvents(userId)],
      ['invites', this.repo.streamInvites(email)],
      ['auditLog', this.repo.streamAuditLog(userId)],
    ];
    for (const [name, rows] of sections) {
      yield `,${JSON.stringify(name)}:[`;
      let first = true;
      for await (const row of rows) {
        yield first ? JSON.stringify(row) : `,${JSON.stringify(row)}`;
        first = false;
      }
      yield ']';
    }
    yield '}';
  }
}
