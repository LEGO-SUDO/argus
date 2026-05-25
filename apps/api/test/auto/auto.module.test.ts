import { Test } from '@nestjs/testing';
import { AutoModule } from '../../src/auto/auto.module';
import { AutoRouterService } from '../../src/auto/auto-router.service';
import { PRISMA_CLIENT_TOKEN } from '../../src/common/prisma.service';
import { createInMemoryPrisma } from '../fixtures/prisma-test-client';

describe('AutoModule', () => {
  it('compiles and resolves AutoRouterService without missing-provider errors', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AutoModule] })
      .overrideProvider(PRISMA_CLIENT_TOKEN)
      .useValue(createInMemoryPrisma())
      .compile();
    const router = moduleRef.get(AutoRouterService);
    expect(router).toBeInstanceOf(AutoRouterService);
    await moduleRef.close();
  });
});
