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
//
// Availability (bug fix): each entry also carries an `available` flag derived
// from the recent inference log (ProviderHealthService). A configured model
// that has failed repeatedly in the last hour is reported `available: false`
// so the picker can grey it out — the catalog otherwise can't tell a working
// key from a broken one (both are "configured").
import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/session.guard';
import {
  SDK_CATALOG,
  type SdkCatalogAccessor,
} from '../common/sdk-catalog.provider';
import {
  ProviderHealthService,
  providerModelKey,
} from './provider-health.service';
import type { ConfiguredProviderEntry } from '@argus/sdk';

/** Catalog entry on the wire — the SDK entry plus a usability flag. */
export type PickerProviderEntry = ConfiguredProviderEntry & {
  /** False when the model is failing repeatedly (see ProviderHealthService). */
  available: boolean;
};

export interface ProvidersResponse {
  providers: PickerProviderEntry[];
}

@Controller('providers')
@UseGuards(SessionGuard)
export class ProvidersController {
  constructor(
    @Inject(SDK_CATALOG) private readonly catalog: SdkCatalogAccessor,
    private readonly health: ProviderHealthService,
  ) {}

  @Get()
  async list(@Req() req: AuthenticatedRequest): Promise<ProvidersResponse> {
    const userId = req.user!.id;
    // Preserve nulls verbatim — the SDK accessor already surfaces null cost
    // / null window fields explicitly (rather than omitting them) for
    // entries missing from the pricebook. We pass through unchanged so the
    // wire shape is "always emit the keys, sometimes null".
    const entries = this.catalog.listConfiguredProviders();
    const unavailable = await this.health.unavailableModelKeys(userId);
    return {
      providers: entries.map((entry) => ({
        ...entry,
        available: !unavailable.has(providerModelKey(entry.provider, entry.model)),
      })),
    };
  }
}
