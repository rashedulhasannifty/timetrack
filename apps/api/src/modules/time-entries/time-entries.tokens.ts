// Split out from time-entries.module.ts for the same reason as reports.tokens.ts /
// projects.tokens.ts: the repository needs this token via @Inject, and the module imports the
// repository — importing the token from the module directly creates a cycle where the symbol is
// still undefined at the point the constructor decorator evaluates it.
export const TRACKING_FRESHNESS_SECONDS = Symbol('TRACKING_FRESHNESS_SECONDS');
