// `GET /providers` — picker catalog endpoint.
//
// chat-context-and-ux-polish LLD Tasks 71/73:
//   - Returns the SDK's `listConfiguredProviders` output under a `providers`
//     key so the response is forward-compat (adding sibling top-level
//     fields later is non-breaking).
//   - Preserves null cost / null context window fields exactly — the picker
//     renders "—" for null cells (LLD Codex-vagueness fix: "Catalog
//     injection" preserves nulls explicitly).
//   - Session-guarded; unauthenticated callers receive 401 via the existing
//     SessionGuard contract.
import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';
import {
  SDK_CATALOG,
  type SdkCatalogAccessor,
} from '../common/sdk-catalog.provider';
import type { ConfiguredProviderEntry } from '@argus/sdk';

export interface ProvidersResponse {
  providers: ConfiguredProviderEntry[];
}

@Controller('providers')
@UseGuards(SessionGuard)
export class ProvidersController {
  constructor(@Inject(SDK_CATALOG) private readonly catalog: SdkCatalogAccessor) {}

  @Get()
  list(): ProvidersResponse {
    // Preserve nulls verbatim — the SDK accessor already surfaces null cost
    // / null window fields explicitly (rather than omitting them) for
    // entries missing from the pricebook. We pass through unchanged so the
    // wire shape is "always emit the keys, sometimes null".
    return { providers: this.catalog.listConfiguredProviders() };
  }
}
