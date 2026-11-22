import { expect, it } from "vite-plus/test";
import { codexPrivateWorkspaceConfig } from "./codexPrivateWorkspace.ts";
it("sets a deny-by-default profile with only the owner's explicit directories writable", () => {
  const config = codexPrivateWorkspaceConfig(["/work/one", "/work/two"]);
  expect(config["permissions.t3-private-workspace"]).toMatchObject({
    filesystem: { ":root": "deny", ":minimal": "read", "/work/one": "write", "/work/two": "write" },
  });
  expect(config.approval_policy).toBe("never");
  expect(config["mcp_servers.t3-code.enabled"]).toBe(false);
});
