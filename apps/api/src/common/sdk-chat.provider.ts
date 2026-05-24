// Nest provider for the SDK `chat.stream` entry point.
//
// chat-context-and-ux-polish backbone — the gateway needs to be able to
// observe the SDK request shape in tests (to assert the pin / budget /
// guess threading lands correctly). Going through a Nest token rather than
// a top-level static import makes that override trivial without monkey-
// patching the SDK module.
import { chat as sdkChat } from '@argus/sdk';
import type { ChatStreamChunk, ChatStreamRequest } from '@argus/sdk';

export const SDK_CHAT_STREAM = 'SDK_CHAT_STREAM';

/** Stream signature consumers depend on. Matches `sdkChat.stream` exactly. */
export type SdkChatStreamFn = (req: ChatStreamRequest) => AsyncIterable<ChatStreamChunk>;

/** Default provider — the real `sdkChat.stream` bound function. */
export const SdkChatStreamProvider = {
  provide: SDK_CHAT_STREAM,
  useValue: sdkChat.stream.bind(sdkChat) as SdkChatStreamFn,
};
