// ProvidersModule — exposes `GET /providers`.
//
// chat-context-and-ux-polish LLD Task 71. AuthModule import gives us the
// SessionGuard; SdkCatalogProvider supplies the SDK_CATALOG token the
// controller injects.
import { Module } from '@nestjs/common';
import { ProvidersController } from './providers.controller';
import { AuthModule } from '../auth/auth.module';
import { SdkCatalogProvider } from '../common/sdk-catalog.provider';

@Module({
  imports: [AuthModule],
  controllers: [ProvidersController],
  providers: [SdkCatalogProvider],
})
export class ProvidersModule {}
