// Split out from approvals.module.ts to break a circular import, same reason as
// reports.tokens.ts: the repository needs this token via @Inject, and the module imports
// the repository.
export const TRACKING_FRESHNESS_SECONDS = Symbol('TRACKING_FRESHNESS_SECONDS');
