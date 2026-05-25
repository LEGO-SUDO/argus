// OrchestratorModule — @Global so the single registry instance is shared
// across the chat gateway, replay service, samples service, and clear service
// without each importing the module explicitly.
import { Global, Module } from '@nestjs/common';
import { OrchestratorRegistry } from './registry';

@Global()
@Module({
  providers: [OrchestratorRegistry],
  exports: [OrchestratorRegistry],
})
export class OrchestratorModule {}
