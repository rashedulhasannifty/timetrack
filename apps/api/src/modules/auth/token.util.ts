const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/**
 * Parses a short duration string ('15m', '30d', '3600s', '2h') to seconds. Used to turn
 * the env-configured token TTLs into a numeric `expiresIn` and a refresh-token `expiresAt`.
 */
export function durationToSeconds(value: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(value.trim());
  const amount = match?.[1];
  const unit = match?.[2];
  const multiplier = unit ? UNIT_SECONDS[unit] : undefined;
  if (!amount || multiplier === undefined) {
    throw new Error(`Invalid duration: ${value} (expected e.g. '15m', '30d')`);
  }
  return Number(amount) * multiplier;
}
