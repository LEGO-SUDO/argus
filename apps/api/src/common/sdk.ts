// Injectable wrapper around the @argus/sdk chat surface.
//
// Phase A calls `chat.stream` as a module import. Phase B needs the surface
// injectable so the Auto classifier adapter + replay service can stub it in
// unit tests. We widen the request with an OPTIONAL `provider` / `model` hint:
// the real SDK ignores unknown fields today (provider selection + failover is
// owned by the packages/sdk LLD — HLD §D3), but passing the hint keeps the
// API contract forward-compatible and lets tests assert which provider/model
// the router intended.
import {
  chat as sdkChat,
  type ChatStreamRequest,
  type ChatStreamChunk,
} from '@argus/sdk';

export type SdkChatRequest = ChatStreamRequest & {
  /** Intended provider id (consumed by the SDK router once it lands). */
  provider?: string;
  /** Intended model id. */
  model?: string;
};

export interface SdkChat {
  stream(req: SdkChatRequest): AsyncIterable<ChatStreamChunk>;
}

export const SDK_CHAT_TOKEN = Symbol('SDK_CHAT');

export const sdkChatProvider = {
  provide: SDK_CHAT_TOKEN,
  useValue: sdkChat as SdkChat,
};
