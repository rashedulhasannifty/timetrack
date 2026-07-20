import { Injectable, NotImplementedException } from '@nestjs/common';
import { TeamSettingsSchema } from '@timetrack/contracts';
import type {
  AuditLogPage,
  AuditLogQuery,
  EraseUser,
  TeamSettings,
  UpdateSettings,
} from '@timetrack/contracts';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';
import { AdminRepository } from './admin.repository.js';

@Injectable()
export class AdminService {
  constructor(private readonly repo: AdminRepository) {}

  listAudit(query: AuditLogQuery): Promise<AuditLogPage> {
    return this.repo.listAudit(query);
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

  eraseUser(_userId: string, _dto: EraseUser, _actor: SessionUser): Promise<void> {
    // TODO(scaffold): right-to-erasure — delete + AuditLog in the same transaction.
    throw new NotImplementedException('admin.eraseUser not yet implemented');
  }
}
