// AutoModule — wires the Auto router providers.
//
// Exports AutoRouterService; provides ClassifierAdapter + the supporting
// primitives (PrismaService, the SDK chat surface, the typed config, Clock).
// The keyword heuristic + category-to-provider are pure functions imported
// directly by the router/adapter, so they need no DI registration.
import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { Clock } from '../common/clock';
import { apiConfigProvider } from '../common/config';
import { sdkChatProvider } from '../common/sdk';
import { ClassifierAdapter } from './classifier-adapter';
import { AutoRouterService } from './auto-router.service';

@Module({
  providers: [
    AutoRouterService,
    ClassifierAdapter,
    PrismaService,
    Clock,
    apiConfigProvider,
    sdkChatProvider,
  ],
  exports: [AutoRouterService],
})
export class AutoModule {}
