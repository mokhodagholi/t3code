# Private chat workspace directories

In Settings → Connections → Create link, enter a private chat account name and select
one or more directories on that environment. The picker shows existing project roots
and lets the owner browse other folders. Selected folders become projects when needed.
The resulting login lists only those projects and can create chats in those folders.
Subdirectories are included. Server checks canonical paths, including symlink targets.

Directory grants belong to the issued link and its sessions. Older unrestricted links
are unchanged; revoke them if the person should retain only the newly restricted login.
A restricted login cannot attach to an older unrestricted chat runtime. Issue an owner
link by leaving the private chat account blank.

The grant is saved in each new thread, inherited by forks and delegated children, and
reused on recovery. Restricted threads use separate Codex processes and a named Codex
filesystem profile that denies filesystem access outside the selected folders and
minimal system runtime files. Changing T3's approval mode cannot widen this profile.
Host terminals, other providers, and externally configured MCP tools are unavailable
for these logins. New worktrees outside the selected folders are not provisioned.

## Ubuntu sandbox setup

On hosts that restrict unprivileged user namespaces, install the service user's helper:

```bash
sudo bash scripts/operations/install-private-workspace-sandbox.sh "$(id -u)" "$(command -v codex)"
```

The script copies the Codex runtime and bubblewrap into a root-owned directory, grants
execution only to the specified service user, and loads an AppArmor namespace grant
for that copy of bubblewrap. The bubblewrap copy uses its supported setuid mode so it
can configure the isolated network namespace on Ubuntu hosts that deny that operation
to unprivileged user namespaces. It does not change the system bubblewrap. Add both
environment assignments printed by the script to the T3 service and restart it.
Re-run the installer when updating the installed Codex runtime.

An unsupported or unavailable sandbox must fail execution; never fall back to
unrestricted tools to make a directory-limited chat work.
