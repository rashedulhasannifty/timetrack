import './test-env.js'; // sets env before AppModule's module-load loadEnv() runs
import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { QueueService } from '../src/infra/queue/queue.module.js';

// Compiling the DI graph needs no containers (compile() does not open connections). This
// catches a dangling provider — e.g. a @Global module (QueueModule) never imported.
//
// NOTE: this repo's vitest e2e run transforms TS via esbuild, which does not emit
// `emitDecoratorMetadata` (design:paramtypes), even though tsconfig sets it. That means
// Nest can't see InvitesService's constructor param types under vitest and silently
// constructs it with `undefined` dependencies instead of throwing — so a bare
// `.compile()` call passes regardless of whether QueueModule is imported (verified: it
// stayed green with the bug still in place). `moduleRef.get(...)` doesn't depend on that
// metadata — it looks the token up directly in the compiled container — so asserting on
// it is the reliable, metadata-independent way to catch a @Global module that was never
// imported.
describe('AppModule DI graph', () => {
  it('registers QueueService (proves QueueModule is imported, not just @Global)', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    expect(moduleRef.get(QueueService, { strict: false })).toBeInstanceOf(QueueService);
    await moduleRef.close();
  });
});
