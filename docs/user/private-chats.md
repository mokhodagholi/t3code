# Private chat accounts

Private chat accounts share an environment's projects while keeping their chat
histories separate. Each account sees its own active and archived chats, search
results, terminal activity, and live chat updates. Forks and delegated tasks keep
the account that owns their parent chat.

The owner creates accounts through **Settings → Sharing & access → Create link**.
Enter a private chat account name, such as `alice`, and give that person the
generated pairing link. Names start with a lowercase letter and can contain
lowercase letters, digits, underscores, and hyphens, up to 32 characters. `owner`
is reserved. Use the same account name when pairing another device with that
person's existing chats. Pairing links work once; each device needs a fresh link.

From the server terminal, an owner can also issue a link with:

```sh
t3 pair --base-dir /path/to/t3-home --user alice
```

Existing chats belong to the owner. A pairing link without a private account name
shares the owner's account, including its chat history. To stop someone from
using an account, revoke their paired devices and any unspent links in Sharing &
access. Do not reuse an account name for a different person unless they should
inherit its history.

Members can use shared projects and create their own chats. Managing projects,
provider credentials, global settings, scheduled tasks, native session imports,
and external MCP authorizations remains an owner operation. Agents started in a
member's chat use that account when accessing T3 chat tools.

These accounts separate access through T3. They are intended for trusted
collaborators: agents and terminals still run as the server's operating-system
user and can access the files that user can read, including stored history.
Separate operating-system users or containers are needed to restrict that access.

When enabling individual accounts on a server that previously authenticated
everyone automatically, remove the proxy's shared credential and revoke the old
shared sessions before inviting members. Each browser must authenticate with
its own pairing link.
