import { Test } from '@nestjs/testing';
import { OrchestratorModule } from '../../src/orchestrator/orchestrator.module';
import { OrchestratorRegistry } from '../../src/orchestrator/registry';

describe('OrchestratorModule', () => {
  it('resolves OrchestratorRegistry as a singleton', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [OrchestratorModule] }).compile();
    const a = moduleRef.get(OrchestratorRegistry);
    const b = moduleRef.get(OrchestratorRegistry);
    expect(a).toBeInstanceOf(OrchestratorRegistry);
    expect(a).toBe(b);
    await moduleRef.close();
  });
});
