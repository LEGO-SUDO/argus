// Registry of repository methods that MUST enforce user ownership.
//
// Tasks 26 + 27. The authorization-filter test enumerates this registry and
// fails the build if a new repository method is added without ownership
// filtering — i.e., the test forces the developer to either prove the
// method is user-scoped or explicitly mark it as user-agnostic here.
//
// Each entry binds a repository method to an invoker `(repo, userId, ctx) =>
// data` that exercises the method with the calling user.
import type { ConversationsRepository } from '../conversations/conversations.repository';
import type { MessagesRepository } from '../conversations/messages.repository';

export type Repos = {
  conversations: ConversationsRepository;
  messages: MessagesRepository;
};

export interface UserScopedInvocation {
  repository: 'conversations' | 'messages';
  method: string;
  /**
   * Invoke `method` on the named repository with the given user id. The
   * `ctx` parameter carries the cross-user fixture's ids (a conversation
   * owned by user A, a message owned by user A, etc.). The invocation MUST
   * return null / [] / false when called with user B.
   */
  invoke: (repos: Repos, userId: string, ctx: AuthFilterContext) => Promise<unknown>;
  /** Expected "empty" shape when authorization filters the row out. */
  empty: unknown;
}

export interface AuthFilterContext {
  conversationId: string;
  messageId: string;
}

export const USER_SCOPED_REPO_METHODS: UserScopedInvocation[] = [
  // ConversationsRepository
  {
    repository: 'conversations',
    method: 'listForUser',
    invoke: async (repos, userId) => repos.conversations.listForUser(userId),
    empty: [],
  },
  {
    repository: 'conversations',
    method: 'getByIdForUser',
    invoke: async (repos, userId, ctx) => repos.conversations.getByIdForUser(ctx.conversationId, userId),
    empty: null,
  },
  {
    repository: 'conversations',
    method: 'rename',
    invoke: async (repos, userId, ctx) => repos.conversations.rename(ctx.conversationId, userId, 'x'),
    empty: false,
  },
  {
    repository: 'conversations',
    method: 'delete',
    invoke: async (repos, userId, ctx) => repos.conversations.delete(ctx.conversationId, userId),
    empty: false,
  },
  // create is intentionally NOT user-scoped read — it WRITES with the supplied
  // userId. The conversations.repository test asserts the row's userId equals
  // the supplied one. Listed here so the test can confirm coverage of
  // every public method (write methods are checked separately).
  // MessagesRepository
  {
    repository: 'messages',
    method: 'listForConversation',
    invoke: async (repos, userId, ctx) => repos.messages.listForConversation(ctx.conversationId, userId),
    empty: [],
  },
  {
    repository: 'messages',
    method: 'getById',
    invoke: async (repos, userId, ctx) => repos.messages.getById(ctx.messageId, userId),
    empty: null,
  },
];

/**
 * Names of public methods on each repository — checked at test time against
 * USER_SCOPED_REPO_METHODS to ensure no method silently dodges the registry.
 */
export const REPOSITORY_PUBLIC_METHODS: Record<'conversations' | 'messages', string[]> = {
  // `create` is a write that takes userId explicitly — covered by
  // conversations.repository.test (Task 24a).
  conversations: ['listForUser', 'getByIdForUser', 'create', 'rename', 'delete'],
  messages: ['listForConversation', 'getById'],
};

/** Methods exempt from the table-driven authorization-filter test. */
export const AUTH_FILTER_EXEMPT_METHODS = new Set<string>([
  // `create` writes with the supplied userId — there's no "filter out
  // someone else's row" semantic to test (the test would just be "did you
  // pass userId through"). Covered by conversations.repository.test.
  'conversations.create',
]);
