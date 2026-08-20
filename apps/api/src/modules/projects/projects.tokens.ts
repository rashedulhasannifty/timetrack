// Split out from projects.module.ts for the same reason as reports.tokens.ts: projects.service.ts
// needs this token via @Inject, and projects.module.ts imports ProjectsService — importing the
// token from the module directly creates a cycle where the symbol is still undefined at the point
// the service's constructor decorator evaluates it.
export const TRACKING_FRESHNESS_SECONDS = Symbol('TRACKING_FRESHNESS_SECONDS');
