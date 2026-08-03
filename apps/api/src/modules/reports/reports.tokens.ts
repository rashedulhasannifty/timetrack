// Split out from reports.module.ts to break a circular import: reports.service.ts needs
// this token via @Inject, and reports.module.ts imports ReportsService — importing the
// token from the module directly created a cycle where the symbol was still undefined at
// the point the service's constructor decorator evaluated it.
export const TRACKING_FRESHNESS_SECONDS = Symbol('TRACKING_FRESHNESS_SECONDS');
