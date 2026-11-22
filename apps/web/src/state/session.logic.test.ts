import { AuthOrchestrationOperateScope, type AuthSessionState } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { expect, it } from "vite-plus/test";
import { sessionHasScope } from "./session.logic";

const session = (userId?: string): AuthSessionState => ({
  authenticated: true,
  auth: {
    policy: "remote-reachable",
    bootstrapMethods: [],
    sessionMethods: [],
    sessionCookieName: "test",
  },
  scopes: [AuthOrchestrationOperateScope],
  ...(userId === undefined ? {} : { userId }),
});

it("keeps private chat operations available while denying shared resource management", () => {
  const result = AsyncResult.success(session("alice"));
  expect(sessionHasScope(result, AuthOrchestrationOperateScope)).toBe(true);
  expect(sessionHasScope(result, AuthOrchestrationOperateScope, true)).toBe(false);
});

it.each([undefined, "owner"])("preserves owner permissions for userId %s", (userId) => {
  expect(
    sessionHasScope(AsyncResult.success(session(userId)), AuthOrchestrationOperateScope, true),
  ).toBe(true);
  expect(
    sessionHasScope(
      AsyncResult.success({ ...session(userId), scopes: [] }),
      AuthOrchestrationOperateScope,
      true,
    ),
  ).toBe(false);
});

it("denies shared management while the session is missing or has failed", () => {
  expect(sessionHasScope(AsyncResult.initial(), AuthOrchestrationOperateScope, true)).toBe(false);
  expect(
    sessionHasScope(AsyncResult.fail("disconnected"), AuthOrchestrationOperateScope, true),
  ).toBe(false);
});
