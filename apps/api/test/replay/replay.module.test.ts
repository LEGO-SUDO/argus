import { Test } from '@nestjs/testing';
import { ReplayModule } from '../../src/replay/replay.module';
import { OrchestratorModule } from '../../src/orchestrator/orchestrator.module';
import { ReplayService } from '../../src/replay/replay.service';
import { PRISMA_CLIENT_TOKEN } from '../../src/common/prisma.service';
import { createInMemoryPrisma } from '../fixtures/prisma-test-client';

describe('ReplayModule', () => {
  it('compiles and resolves ReplayService', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ReplayModule, OrchestratorModule] })
      .overrideProvider(PRISMA_CLIENT_TOKEN)
      .useValue(createInMemoryPrisma())
      .compile();
    expect(moduleRef.get(ReplayService)).toBeInstanceOf(ReplayService);
    await moduleRef.close();
  });
});
