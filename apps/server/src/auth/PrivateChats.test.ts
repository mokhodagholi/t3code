import { CurrentWorkspaceDirectories } from "./PrivateWorkspaces.ts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as SqlClient from "effect/sql/SqlClient";
import {
  authorizeThreadReferences,
  canReadThread,
  chatUserForSubject,
  CurrentChatUser,
  privateChatScopes,
  referencedThreads,
  threadVisibility,
} from "./PrivateChats.ts";

it("keeps account identity stable across sessions and leaves legacy chats with the owner", () => {
  assert.strictEqual(chatUserForSubject("chat-user:alice"), "alice");
  assert.strictEqual(chatUserForSubject("one-time-token"), "owner");
  assert.deepEqual(
    privateChatScopes([
      "orchestration:read",
      "orchestration:operate",
      "access:write",
      "settings:write",
    ]),
    ["orchestration:read", "orchestration:operate"],
  );
  assert.deepEqual(
    referencedThreads({
      sourceThreadId: "a",
      targetThreadId: "b",
      nested: { threadIds: ["a", "c"] },
      text: "hello",
    }),
    ["a", "b", "c"],
  );
});

it.effect("checks all chat references and filters rows before pagination", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE orchestration_v2_projection_threads (thread_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL)`;
    for (const [id, owner] of [
      ["alice-chat", "alice"],
      ["bob-chat", "bob"],
      ["old-chat", null],
    ] as const) {
      yield* sql`INSERT INTO orchestration_v2_projection_threads VALUES (${id}, ${JSON.stringify(owner === null ? {} : { ownerUserId: owner })})`;
    }
    const checkAlice = Effect.gen(function* () {
      assert.isTrue(yield* canReadThread(sql, "alice-chat"));
      assert.isFalse(yield* canReadThread(sql, "bob-chat"));
      assert.isFalse(yield* canReadThread(sql, "old-chat"));
      const visible = yield* threadVisibility(sql, "t");
      const rows = yield* sql<{
        thread_id: string;
      }>`SELECT t.thread_id FROM orchestration_v2_projection_threads t WHERE ${visible} ORDER BY t.thread_id LIMIT 1`;
      assert.deepEqual(
        rows.map((row) => row.thread_id),
        ["alice-chat"],
      );
      yield* authorizeThreadReferences(sql, {
        type: "thread.fork",
        sourceThreadId: "alice-chat",
        targetThreadId: "new-chat",
      });
      const forbidden = yield* Effect.flip(
        authorizeThreadReferences(sql, {
          sourceThreadId: "alice-chat",
          targetThreadId: "bob-chat",
        }),
      );
      assert.strictEqual(forbidden._tag, "EnvironmentAuthorizationError");
    });
    yield* checkAlice.pipe(Effect.provideService(CurrentChatUser, "alice"));
    assert.isTrue(
      yield* canReadThread(sql, "old-chat").pipe(Effect.provideService(CurrentChatUser, "owner")),
    );
    assert.isTrue(yield* canReadThread(sql, "bob-chat"));
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);

it.effect(
  "filters private chats by directory grant before pagination and rejects unrestricted runtimes",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TABLE orchestration_v2_projection_threads (thread_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL)`;
      for (const [id, roots] of [
        ["a-outside", ["/outside"]],
        ["b-broad", ["/allowed", "/outside"]],
        ["c-legacy", undefined],
        ["d-inside", ["/allowed/child"]],
        ["e-empty", []],
      ] as const) {
        yield* sql`INSERT INTO orchestration_v2_projection_threads VALUES (${id}, ${JSON.stringify({ ownerUserId: "alice", ...(roots === undefined ? {} : { allowedDirectories: roots }) })})`;
      }
      const check = Effect.gen(function* () {
        const visible = yield* threadVisibility(sql, "t");
        const rows = yield* sql<{
          thread_id: string;
        }>`SELECT t.thread_id FROM orchestration_v2_projection_threads AS t WHERE ${visible} ORDER BY t.thread_id LIMIT 1`;
        assert.deepEqual(
          rows.map((row) => row.thread_id),
          ["d-inside"],
        );
        assert.isTrue(yield* canReadThread(sql, "d-inside"));
        assert.isFalse(yield* canReadThread(sql, "b-broad"));
        assert.isFalse(yield* canReadThread(sql, "c-legacy"));
        assert.isFalse(yield* canReadThread(sql, "e-empty"));
        const denied = yield* Effect.flip(
          authorizeThreadReferences(sql, { cwd: "/outside", relativePath: "secret.txt" }),
        );
        assert.equal(denied._tag, "EnvironmentAuthorizationError");
      });
      yield* check.pipe(
        Effect.provideService(CurrentChatUser, "alice"),
        Effect.provideService(CurrentWorkspaceDirectories, ["/allowed"]),
      );
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
