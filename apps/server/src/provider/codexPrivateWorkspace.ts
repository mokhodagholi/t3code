import type * as Schema from "effect/Schema";

/** Fixed by the server; a user's runtime-mode choice never widens this profile. */
const PRIVATE_WORKSPACE_PROFILE = "t3-private-workspace";
export function codexPrivateWorkspaceConfig(
  directories: ReadonlyArray<string>,
): Readonly<Record<string, Schema.Json>> {
  return {
    default_permissions: PRIVATE_WORKSPACE_PROFILE,
    [`permissions.${PRIVATE_WORKSPACE_PROFILE}`]: {
      filesystem: {
        ":root": "deny",
        ":minimal": "read",
        ...Object.fromEntries(directories.map((path) => [path, "write"])),
      },
      network: { enabled: true },
    },
    approval_policy: "never",
    "mcp_servers.t3-code.enabled": false,
    "mcp_servers.t3-code-direct.enabled": false,
  };
}
