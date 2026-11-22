import {
  AuthAccessWriteScope,
  OrchestratorMcpFailure,
  type AuthEnvironmentScope,
  EnvironmentAuthorizationError,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Background orchestration has no caller; authenticated entry points always supply one.
export const CurrentChatUser = Context.Reference<string | undefined>("t3/auth/CurrentChatUser", {
  defaultValue: () => undefined,
});

export const chatUserForSubject = (subject: string): string =>
  subject.startsWith("chat-user:") ? subject.slice("chat-user:".length) : "owner";

export const privateChatScopes = (scopes: ReadonlyArray<AuthEnvironmentScope>) =>
  scopes.filter(
    (scope) =>
      ![
        "access:read",
        "access:write",
        "settings:write",
        "providers:manage",
        "environment:maintain",
        "diagnostics:read",
        "relay:read",
        "relay:write",
        "relay:configure",
      ].includes(scope),
  );

export const threadVisibility = Effect.fn("PrivateChats.threadVisibility")(function* (
  sql: SqlClient.SqlClient,
  alias = "t",
) {
  const userId = yield* CurrentChatUser;
  return userId === undefined
    ? sql`1`
    : sql`COALESCE(json_extract(${sql(alias + ".payload_json")}, '$.ownerUserId'), 'owner') = ${userId}`;
});

export const canReadThread = Effect.fn("PrivateChats.canReadThread")(function* (
  sql: SqlClient.SqlClient,
  threadId: string,
) {
  const userId = yield* CurrentChatUser;
  if (userId === undefined) return true;
  const rows = yield* sql<{ readonly owner: string }>`
    SELECT COALESCE(json_extract(payload_json, '$.ownerUserId'), 'owner') AS owner
    FROM orchestration_v2_projection_threads WHERE thread_id = ${threadId}
  `;
  return rows[0]?.owner === userId;
});

const threadReferenceKeys = new Set([
  "threadId",
  "sourceThreadId",
  "targetThreadId",
  "parentThreadId",
  "appThreadId",
  "familyOf",
]);

export function referencedThreads(payload: unknown): ReadonlyArray<string> {
  const ids = new Set<string>();
  const visit = (value: unknown) => {
    if (value === null || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value)) {
      if ((threadReferenceKeys.has(key) || key.endsWith("ThreadId")) && typeof entry === "string")
        ids.add(entry);
      else if ((key === "threadIds" || key.endsWith("ThreadIds")) && Array.isArray(entry)) {
        for (const id of entry) if (typeof id === "string") ids.add(id);
      } else if (key !== "text" && key !== "context") visit(entry);
    }
  };
  visit(payload);
  return [...ids];
}

export const authorizeThreadReferences = Effect.fn("PrivateChats.authorizeThreadReferences")(
  function* (sql: SqlClient.SqlClient, payload: unknown, method?: string) {
    const userId = yield* CurrentChatUser;
    if (userId === undefined) return;
    const newIds = new Set<string>();
    if (payload !== null && typeof payload === "object") {
      const input = payload as Record<string, unknown>;
      if (
        (input.type === "thread.create" || method === "orchestration.launchThread") &&
        typeof input.threadId === "string"
      )
        newIds.add(input.threadId);
      if (input.type === "thread.fork" && typeof input.targetThreadId === "string")
        newIds.add(input.targetThreadId);
    }
    for (const threadId of referencedThreads(payload)) {
      const rows = yield* sql<{ readonly owner: string }>`
      SELECT COALESCE(json_extract(payload_json, '$.ownerUserId'), 'owner') AS owner
      FROM orchestration_v2_projection_threads WHERE thread_id = ${ThreadId.make(threadId)}
    `.pipe(
        Effect.mapError(
          () =>
            new EnvironmentAuthorizationError({
              requiredScope: AuthAccessWriteScope,
              message: "The chat is unavailable.",
            }),
        ),
      );
      if (rows.length === 0 ? !newIds.has(threadId) : rows[0]?.owner !== userId) {
        return yield* new EnvironmentAuthorizationError({
          requiredScope: AuthAccessWriteScope,
          message: "The chat is unavailable.",
        });
      }
    }
  },
);

export const requireChatOwner = CurrentChatUser.pipe(
  Effect.flatMap((userId) =>
    userId === undefined || userId === "owner"
      ? Effect.void
      : Effect.fail(
          new OrchestratorMcpFailure({
            code: "capability_denied",
            message: "This operation requires the owner's account.",
          }),
        ),
  ),
);
