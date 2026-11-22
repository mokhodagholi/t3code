// @effect-diagnostics nodeBuiltinImport:off -- Exercise real symlinks and host path containment.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { chatUserForSubject } from "./PrivateChats.ts";
import {
  canAccessWorkspacePath,
  normalizeWorkspaceDirectories,
  pathIsWithin,
  privateWorkspaceSubject,
  workspaceDirectoriesForSubject,
} from "./PrivateWorkspaces.ts";

it("round trips server-issued directory grants and refuses malformed restrictions", () => {
  assert.equal(chatUserForSubject(privateWorkspaceSubject("alice", ["/work/one"])), "alice");
  assert.deepEqual(
    workspaceDirectoriesForSubject(privateWorkspaceSubject("alice", ["/work/one", "/work/two"])),
    ["/work/one", "/work/two"],
  );
  assert.isUndefined(workspaceDirectoriesForSubject("chat-user:alice"));
  assert.deepEqual(workspaceDirectoriesForSubject("chat-user:alice:directories:invalid"), []);
  assert.isFalse(pathIsWithin("/work/one", "/work/one-more"));
  assert.isFalse(pathIsWithin("/work/one", "/work/one/../two"));
});

it.effect("checks real targets and missing descendants without allowing symlink escapes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* Effect.acquireRelease(
        Effect.promise(() =>
          NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-private-workspace-")),
        ),
        (path) => Effect.promise(() => NodeFSP.rm(path, { recursive: true, force: true })),
      );
      const allowed = NodePath.join(base, "allowed");
      const other = NodePath.join(base, "other");
      yield* Effect.promise(async () => {
        await NodeFSP.mkdir(allowed);
        await NodeFSP.mkdir(other);
        await NodeFSP.symlink(other, NodePath.join(allowed, "escape"));
      });
      assert.isTrue(yield* canAccessWorkspacePath(NodePath.join(allowed, "new-file"), [allowed]));
      assert.isFalse(
        yield* canAccessWorkspacePath(NodePath.join(allowed, "escape", "new-file"), [allowed]),
      );
      assert.isFalse(yield* canAccessWorkspacePath(other, [allowed]));
      assert.deepEqual(
        yield* Effect.promise(() => normalizeWorkspaceDirectories([allowed, allowed])),
        [allowed],
      );
    }),
  ),
);
