// ProvidersController — GET /providers/availability (bare path). Returns the
// per-provider model catalog + which providers are usable in this deployment.
// SessionGuard-protected (the selector is rendered for an authenticated user).
import { Controller, Get, UseGuards } from '@nestjs/common';
import type { ProviderAvailabilityResponse } from '@argus/contracts';
import { SessionGuard } from '../auth/session.guard';
import { buildProviderAvailability } from './provider-availability';

@Controller('providers')
@UseGuards(SessionGuard)
export class ProvidersController {
  @Get('availability')
  availability(): ProviderAvailabilityResponse {
    return buildProviderAvailability({
      openai: Boolean(process.env.OPENAI_API_KEY),
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      gemini: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    });
  }
}
