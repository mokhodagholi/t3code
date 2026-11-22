import {
  CurrentWorkspaceDirectories,
  requireWorkspacePath,
  pathIsWithin,
  encodeWorkspaceDirectories,
  parseThreadDirectoryGrants,
} from "./PrivateWorkspaces.ts";
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
  subject.startsWith("chat-user:") ? subject.split(":")[1]! : "owner";

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
  const ownership =
    userId === undefined
      ? sql`1`
      : sql`COALESCE(json_extract(${sql(alias + ".payload_json")}, '$.ownerUserId'), 'owner') = ${userId}`;
  const directories = yield* CurrentWorkspaceDirectories;
  if (directories === undefined) return ownership;
  if (directories.length === 0) return sql`0`;
  return sql`(${ownership}) AND json_type(${sql(alias + ".payload_json")}, '$.allowedDirectories') = 'array'
    AND NOT EXISTS (SELECT 1 FROM json_each(${sql(alias + ".payload_json")}, '$.allowedDirectories') AS grant_root
      WHERE NOT EXISTS (SELECT 1 FROM json_each(${encodeWorkspaceDirectories(directories)}) AS allowed_root
        WHERE allowed_root.value = '/' OR grant_root.value = allowed_root.value OR substr(grant_root.value, 1, length(allowed_root.value) + 1) = allowed_root.value || '/'))`;
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
  if (rows[0]?.owner !== userId) return false;
  const directories = yield* CurrentWorkspaceDirectories;
  if (directories === undefined) return true;
  const [thread] = yield* sql<{
    readonly payload: string;
  }>`SELECT payload_json AS payload FROM orchestration_v2_projection_threads WHERE thread_id = ${threadId}`;
  const grants = thread === undefined ? undefined : parseThreadDirectoryGrants(thread.payload);
  return (
    grants !== undefined &&
    grants.length > 0 &&
    grants.every((root) => directories.some((allowed) => pathIsWithin(allowed, root)))
  );
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
    if (
      (yield* CurrentWorkspaceDirectories) !== undefined &&
      payload !== null &&
      typeof payload === "object" &&
      "workspaceStrategy" in payload &&
      payload.workspaceStrategy !== null &&
      typeof payload.workspaceStrategy === "object" &&
      "type" in payload.workspaceStrategy &&
      payload.workspaceStrategy.type === "worktree"
    )
      return yield* new EnvironmentAuthorizationError({
        requiredScope: AuthAccessWriteScope,
        message: "Use an existing directory for this private account.",
      });
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
    const inspectPaths = function* (
      value: unknown,
      cwd?: string,
    ): Generator<Effect.Effect<void, EnvironmentAuthorizationError>, void, unknown> {
      if (value === null || typeof value !== "object") return;
      const object = value as Record<string, unknown>;
      const base = typeof object.cwd === "string" ? object.cwd : cwd;
      for (const [key, entry] of Object.entries(object)) {
        if (
          ["cwd", "workspaceRoot", "worktreePath", "filePath", "absolutePath", "path"].includes(
            key,
          ) &&
          typeof entry === "string"
        )
          yield requireWorkspacePath(base && !entry.startsWith("/") ? `${base}/${entry}` : entry);
        else if (key === "relativePath" && typeof entry === "string" && base)
          yield requireWorkspacePath(`${base}/${entry}`);
        else if (key === "paths" && Array.isArray(entry)) {
          for (const path of entry) if (typeof path === "string") yield requireWorkspacePath(path);
        } else if (key !== "text" && key !== "context") yield* inspectPaths(entry, base);
      }
    };
    for (const check of inspectPaths(payload)) yield* check;
    if (
      method === "filesystem.browse" &&
      payload !== null &&
      typeof payload === "object" &&
      "partialPath" in payload &&
      typeof payload.partialPath === "string"
    ) {
      const partial = payload.partialPath;
      yield* requireWorkspacePath(
        partial.endsWith("/") ? partial : partial.slice(0, partial.lastIndexOf("/") + 1),
      );
    }
    if (
      (yield* CurrentWorkspaceDirectories) !== undefined &&
      payload !== null &&
      typeof payload === "object" &&
      "projectId" in payload &&
      typeof payload.projectId === "string"
    ) {
      const [project] = yield* sql<{
        readonly root: string;
      }>`SELECT workspace_root AS root FROM projection_projects WHERE project_id = ${payload.projectId}`.pipe(
        Effect.mapError(
          () =>
            new EnvironmentAuthorizationError({
              requiredScope: AuthAccessWriteScope,
              message: "The workspace is unavailable.",
            }),
        ),
      );
      if (project) yield* requireWorkspacePath(project.root);
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
      if (
        rows.length === 0
          ? !newIds.has(threadId)
          : !(yield* canReadThread(sql, threadId).pipe(
              Effect.mapError(
                () =>
                  new EnvironmentAuthorizationError({
                    requiredScope: AuthAccessWriteScope,
                    message: "The chat is unavailable.",
                  }),
              ),
            ))
      ) {
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
