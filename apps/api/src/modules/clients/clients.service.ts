import { ForbiddenException, Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { ClientHeadersSchema, type ClientInstall, type Platform } from '@timetrack/contracts';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';
import { ClientsRepository } from './clients.repository.js';

/** What the calling desktop app said it is. */
export interface ClientReport {
  platform: Platform;
  version: string;
}

/**
 * Mac builds released before the app sent X-Client-Version, keyed by CFBundleVersion (every
 * release bumped it by one). The app sets no User-Agent of its own, and URLSession's default is
 * expected to be "<app>/<CFBundleVersion> CFNetwork/… Darwin/…" — not yet confirmed against a
 * shipped build. If it is not, these users show as "not reported", never as a wrong version.
 * Frozen: every build after 9 sends the header, so this table never grows.
 */
const LEGACY_MAC_BUILDS: Readonly<Record<string, string>> = {
  '2': '0.2.0',
  '3': '0.3.0',
  '4': '0.4.0',
  '5': '0.4.1',
  '6': '0.5.0',
  '7': '0.5.1',
  '8': '0.6.0',
  '9': '0.6.1',
};

const LEGACY_MAC_UA = /^[^/\s]+\/(\d{1,3}) CFNetwork\/[\d.]+ Darwin\//;

/**
 * Read the calling app's platform and version off the request headers. Lenient by design: a
 * missing or malformed header yields null (record nothing), never an error — the dashboard's
 * server calls and every older app send none, and sign-in must not depend on them.
 */
export function clientFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): ClientReport | null {
  const parsed = ClientHeadersSchema.safeParse(headers);
  if (parsed.success) {
    return {
      platform: parsed.data['x-client-platform'],
      version: parsed.data['x-client-version'],
    };
  }
  const ua = headers['user-agent'];
  const build = typeof ua === 'string' ? LEGACY_MAC_UA.exec(ua)?.[1] : undefined;
  const legacy = build ? LEGACY_MAC_BUILDS[build] : undefined;
  return legacy ? { platform: 'MACOS', version: legacy } : null;
}

@Injectable()
export class ClientsService {
  constructor(
    private readonly repo: ClientsRepository,
    private readonly logger: Logger,
  ) {}

  /**
   * Best effort: a failed write is logged and swallowed. This runs inside login and refresh,
   * and a bookkeeping row must never be the reason someone is signed out.
   */
  async record(userId: string, client: ClientReport | null): Promise<void> {
    if (!client) return;
    try {
      await this.repo.upsert({ userId, ...client, lastSeenAt: new Date() });
    } catch (e) {
      // `reason`, not `err`: pino treats `err` specially and drops a plain message under it.
      this.logger.warn(
        { userId, platform: client.platform, reason: e instanceof Error ? e.message : String(e) },
        'client version not recorded',
      );
    }
  }

  async list(actor: SessionUser): Promise<ClientInstall[]> {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException({
        type: 'https://timetrack.internal/errors/forbidden',
        title: 'Only an admin can list client versions',
        status: 403,
      });
    }
    const rows = await this.repo.list();
    return rows.map((r) => ({ ...r, lastSeenAt: r.lastSeenAt.toISOString() }));
  }
}
