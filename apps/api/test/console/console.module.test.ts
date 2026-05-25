import { Test } from '@nestjs/testing';
import { ConsoleModule } from '../../src/console/console.module';
import { ConsoleController } from '../../src/console/console.controller';
import { LiveController } from '../../src/console/live.controller';
import { ProvidersController } from '../../src/console/providers.controller';
import { PRISMA_CLIENT_TOKEN } from '../../src/common/prisma.service';
import { createInMemoryPrisma } from '../fixtures/prisma-test-client';

describe('ConsoleModule', () => {
  it('compiles and resolves all three controllers with their dependencies wired', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ConsoleModule] })
      .overrideProvider(PRISMA_CLIENT_TOKEN)
      .useValue(createInMemoryPrisma())
      .compile();
    expect(moduleRef.get(ConsoleController)).toBeInstanceOf(ConsoleController);
    expect(moduleRef.get(LiveController)).toBeInstanceOf(LiveController);
    expect(moduleRef.get(ProvidersController)).toBeInstanceOf(ProvidersController);
    await moduleRef.close();
  });
});
