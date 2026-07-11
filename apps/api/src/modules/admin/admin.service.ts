import { Injectable, NotImplementedException } from '@nestjs/common';
import type {
  AuditLogEntry,
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

  listAudit(query: AuditLogQuery): Promise<AuditLogEntry[]> {
    return this.repo.listAudit(query);
  }

  updateSettings(_patch: UpdateSettings, _actor: SessionUser): Promise<TeamSettings> {
    // TODO(scaffold): merge + validate via TeamSettingsSchema, write, audit in one tx.
    throw new NotImplementedException('admin.updateSettings not yet implemented');
  }

  eraseUser(_userId: string, _dto: EraseUser, _actor: SessionUser): Promise<void> {
    // TODO(scaffold): right-to-erasure — delete + AuditLog in the same transaction.
    throw new NotImplementedException('admin.eraseUser not yet implemented');
  }
}
