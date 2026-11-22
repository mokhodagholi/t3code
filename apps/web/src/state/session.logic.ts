import {
  sessionGrantsScope,
  type AuthEnvironmentScope,
  type AuthSessionState,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";

/** Shared resources remain owner-only even when private users can operate their own chats. */
export function sessionHasScope(
  result: AsyncResult.AsyncResult<AuthSessionState, unknown>,
  scope: AuthEnvironmentScope,
  ownerOnly = false,
): boolean {
  const session = AsyncResult.getOrElse(result, () => null);
  return (
    result._tag !== "Failure" &&
    session !== null &&
    (!ownerOnly || session.userId === undefined || session.userId === "owner") &&
    sessionGrantsScope(session, scope)
  );
}
