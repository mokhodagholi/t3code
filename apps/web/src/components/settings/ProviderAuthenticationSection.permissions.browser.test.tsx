import { EnvironmentId, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../test/render";

const state = vi.hoisted(() => ({ canManage: false, query: vi.fn() }));
vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: () => state.canManage,
}));
vi.mock(import("../../state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: ((atom: unknown) => {
    state.query(atom);
    return { data: null, error: null };
  }) as never,
}));
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => vi.fn()) as never,
}));

import { ProviderAuthenticationSection } from "./ProviderAuthenticationSection";

it.each([false, true])(
  "subscribes to provider sign-in only with provider management (allowed: %s)",
  async (canManage) => {
    state.canManage = canManage;
    state.query.mockClear();
    await using screen = await render(
      <ProviderAuthenticationSection
        environmentId={EnvironmentId.make("remote")}
        environmentLabel="Remote"
        instanceId={ProviderInstanceId.make("claude")}
        provider={
          { driver: "claude", installed: true, auth: { status: "authenticated" } } as ServerProvider
        }
        readOnly={!canManage}
      />,
    );
    expect(state.query).toHaveBeenCalled();
    for (const [atom] of state.query.mock.calls) {
      if (canManage) expect(atom).not.toBeNull();
      else expect(atom).toBeNull();
    }
    await expect.element(screen.getByText("Signed in.", { exact: true })).toBeVisible();
  },
);
