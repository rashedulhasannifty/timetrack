import { Injectable } from '@nestjs/common';

/**
 * SCAFFOLD. The team-summary aggregate and CSV row stream go here.
 * Aggregate in ONE query (CLAUDE.md §4), not N+1 — a per-user duration sum joined to
 * users, plus an activity-% roll-up from activity_samples. Inject PrismaService when
 * implementing.
 */
@Injectable()
export class ReportsRepository {
  // TODO(scaffold): teamSummary(teamId, from, to) — grouped duration + activity %.
  // TODO(scaffold): streamCsvRows(query) — an async generator so export never buffers
  //                 the whole result set in memory.
}
