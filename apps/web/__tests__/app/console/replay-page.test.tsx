// Regression: the /console/replay server page must read the deep-link source
// param under the name the trace drawer actually sets (?sourceId=). It used to
// read ?source=, so the trace-drawer "replay" link (and a refresh of the
// per-source URL) fell through to the candidate picker instead of pre-loading
// the comparison view.
//
// The page is an async server component; we mock the session resolver + the
// server fetchers and assert the fetch decision (we don't render the returned
// tree, which depends on the client ReplayTab).
jest.mock('@/lib/server-session', () => ({ sessionCookieHeader: jest.fn() }));
jest.mock('@/lib/console-api.server', () => ({
  fetchReplayDetailServer: jest.fn(),
  fetchReplayCandidatesServer: jest.fn(),
  fetchProviderAvailabilityServer: jest.fn(),
}));
// Stub the client component so importing the page doesn't drag client-only deps.
jest.mock('@/components/console/replay/ReplayTab', () => ({ ReplayTab: () => null }));

import { sessionCookieHeader } from '@/lib/server-session';
import {
  fetchReplayDetailServer,
  fetchReplayCandidatesServer,
  fetchProviderAvailabilityServer,
} from '@/lib/console-api.server';
import ReplayPage from '@/app/console/replay/page';

const mockDetail = fetchReplayDetailServer as jest.Mock;
const mockCandidates = fetchReplayCandidatesServer as jest.Mock;
const mockAvail = fetchProviderAvailabilityServer as jest.Mock;
const mockCookie = sessionCookieHeader as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockCookie.mockResolvedValue('cookie-header');
  mockAvail.mockResolvedValue({ providers: [], snapshotDate: '' });
  mockDetail.mockResolvedValue({ id: 'src-1' });
  mockCandidates.mockResolvedValue({ candidates: [], next_cursor: null });
});

describe('/console/replay page — deep-link source param', () => {
  it('fetches the replay detail for ?sourceId=<id> (the trace-drawer deep link)', async () => {
    await ReplayPage({ searchParams: Promise.resolve({ sourceId: 'src-1' }) });
    expect(mockDetail).toHaveBeenCalledWith('src-1', 'cookie-header');
    expect(mockCandidates).not.toHaveBeenCalled();
  });

  it('accepts the legacy ?source=<id> param as a fallback', async () => {
    await ReplayPage({ searchParams: Promise.resolve({ source: 'src-2' }) });
    expect(mockDetail).toHaveBeenCalledWith('src-2', 'cookie-header');
    expect(mockCandidates).not.toHaveBeenCalled();
  });

  it('falls back to the candidate list when no source param is present', async () => {
    await ReplayPage({ searchParams: Promise.resolve({}) });
    expect(mockDetail).not.toHaveBeenCalled();
    expect(mockCandidates).toHaveBeenCalled();
  });
});
