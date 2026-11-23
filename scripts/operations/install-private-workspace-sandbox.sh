#!/usr/bin/env bash
# Ubuntu's restricted user namespaces need an AppArmor grant for bubblewrap.
# Install a root-owned setuid copy executable only by the T3 service user. The
# setuid transition lets bubblewrap configure loopback in its isolated network
# namespace when the host denies that operation to unprivileged user namespaces.
set -euo pipefail
if [[ ${EUID} != 0 || $# != 2 || ! $1 =~ ^[0-9]+$ || $1 == 0 ]]; then
  echo 'Usage: sudo bash scripts/operations/install-private-workspace-sandbox.sh <service-uid> <codex-binary>' >&2
  exit 1
fi
service_uid=$1
codex_source=$(readlink -f "$2")
test -f "$codex_source"
getent passwd "$service_uid" >/dev/null
sandbox_directory="/usr/local/lib/t3code-private-workspaces/$service_uid"
profile_file="/etc/apparmor.d/t3code-private-workspaces-$service_uid"
install -d -o root -g root -m 0755 /usr/local/lib/t3code-private-workspaces
install -d -o root -g root -m 0700 "$sandbox_directory"
install -o root -g root -m 4750 /usr/bin/bwrap "$sandbox_directory/bwrap"
setfacl -m "u:$service_uid:rx,m::rx" "$sandbox_directory" "$sandbox_directory/bwrap"
for binary_name in codex codex-code-mode-host codex-exec-server; do
  source_binary="$(dirname "$codex_source")/$binary_name"
  if [[ -f $source_binary ]]; then
    install -o root -g root -m 0700 "$source_binary" "$sandbox_directory/$binary_name"
    setfacl -m "u:$service_uid:rx" "$sandbox_directory/$binary_name"
  fi
done
cat > "$profile_file" <<PROFILE
abi <abi/4.0>,
include <tunables/global>
profile t3code-private-workspaces-$service_uid "$sandbox_directory/bwrap" flags=(unconfined) {
  userns,
}
PROFILE
chmod 0644 "$profile_file"
apparmor_parser -r "$profile_file"
printf 'T3CODE_PRIVATE_WORKSPACE_BWRAP_DIR=%s\nT3CODE_PRIVATE_WORKSPACE_CODEX_BIN=%s/codex\n' "$sandbox_directory" "$sandbox_directory"
