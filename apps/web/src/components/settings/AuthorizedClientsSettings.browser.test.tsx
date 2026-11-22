import {
  EnvironmentId,
  AuthStandardClientScopes,
  managedCapabilityDenial,
  type ManagedPolicySummary,
} from "@t3tools/contracts";
import { userEvent, page } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { render } from "../../../test/render";
import { AuthorizedClientsHeaderAction } from "./AuthorizedClientsSettings";

const localId = EnvironmentId.make("local");
const serviceId = EnvironmentId.make("service");

const state = vi.hoisted(() => ({
  primaryEnvironmentId: null as string | null,
  policies: new Map<string, unknown>(),
  create: vi.fn(),
}));

vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  usePrimaryEnvironmentId: (() => state.primaryEnvironmentId) as never,
}));
vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useProjects: (() => [
    { environmentId: serviceId, id: "a", title: "Owner project", workspaceRoot: "/work/owner" },
    {
      environmentId: localId,
      id: "b",
      title: "Other machine",
      workspaceRoot: "/work/other-machine",
    },
  ]) as never,
  useServerConfigs: (() =>
    new Map(
      [...state.policies].map(([environmentId, managedPolicy]) => [
        environmentId,
        { managedPolicy },
      ]),
    )) as never,
}));
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => state.create) as never,
}));

vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
}));
vi.mock(import("../../state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: (() => ({
    data: {
      parentPath: "/home/owner",
      entries: [{ name: "additional", fullPath: "/home/owner/additional" }],
    },
    error: null,
  })) as never,
}));

const remoteClientsOff: ManagedPolicySummary = {
  organization: "Example Corp",
  lockedSettings: [],
  limits: { clients: ["desktop"] },
};

function setup(policies: ReadonlyArray<readonly [EnvironmentId, ManagedPolicySummary]>) {
  state.create
    .mockReset()
    .mockResolvedValue({ _tag: "Success", value: { credential: "test-only", id: "test-only" } });
  state.primaryEnvironmentId = localId;
  state.policies = new Map(policies);
}

const renderHeader = (
  environmentId: EnvironmentId,
  scopes = [] as readonly (typeof AuthStandardClientScopes)[number][],
) =>
  render(
    <AuthorizedClientsHeaderAction
      environmentId={environmentId}
      onPairingLinkCreated={() => {}}
      clientSessions={null}
      isRevokingOtherClients={false}
      onRevokeOtherClients={() => {}}
      delegatableScopes={scopes}
    />,
  );

describe("AuthorizedClientsHeaderAction", () => {
  const denial = managedCapabilityDenial(remoteClientsOff, "remoteClients")!;

  it("follows the selected service's policy, not the primary's", async () => {
    setup([[serviceId, remoteClientsOff]]);
    await using screen = await renderHeader(serviceId);

    await expect.element(screen.getByRole("group", { name: denial })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Create link" })).toBeDisabled();
  });

  it("leaves pairing open on an unmanaged service when the primary is managed", async () => {
    setup([[localId, remoteClientsOff]]);
    await using screen = await renderHeader(serviceId);

    await expect.element(screen.getByRole("button", { name: "Create link" })).toBeEnabled();
    expect(screen.getByRole("group", { name: denial }).query()).toBeNull();
  });

  it("shows owner directories for a private account", async () => {
    setup([]);
    await using screen = await renderHeader(serviceId, AuthStandardClientScopes);

    await userEvent.click(screen.getByRole("button", { name: "Create link" }));
    await userEvent.fill(
      screen.getByRole("textbox", { name: "Private chat account (optional)" }),
      "alice",
    );
    await expect.element(screen.getByText("/work/owner")).toBeVisible();
  });
});
