// @effect-diagnostics nodeBuiltinImport:off -- Canonical host paths are the security boundary.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { AuthFilesystemReadScope, EnvironmentAuthorizationError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

export const CurrentWorkspaceDirectories = Context.Reference<ReadonlyArray<string> | undefined>(
  "t3/auth/CurrentWorkspaceDirectories",
  { defaultValue: () => undefined },
);

export function pathIsWithin(directory: string, target: string): boolean {
  const relative = NodePath.relative(directory, target);
  return (
    relative === "" ||
    (!relative.startsWith(`..${NodePath.sep}`) &&
      relative !== ".." &&
      !NodePath.isAbsolute(relative))
  );
}

/** Resolve the existing ancestor too: a missing target must not hide a symlink escape. */
export async function canonicalWorkspacePath(input: string): Promise<string> {
  const expanded =
    input === "~"
      ? NodeOS.homedir()
      : input.startsWith("~/")
        ? NodePath.join(NodeOS.homedir(), input.slice(2))
        : input;
  if (!NodePath.isAbsolute(expanded)) throw new Error("Choose an absolute directory path.");
  const resolved = NodePath.resolve(expanded);
  try {
    return await NodeFSP.realpath(resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = NodePath.dirname(resolved);
    if (parent === resolved) throw error;
    return NodePath.join(await canonicalWorkspacePath(parent), NodePath.basename(resolved));
  }
}

export async function normalizeWorkspaceDirectories(
  paths: ReadonlyArray<string>,
): Promise<ReadonlyArray<string>> {
  if (paths.length === 0 || paths.length > 32)
    throw new Error("Choose at least one allowed directory.");
  const directories: string[] = [];
  for (const path of paths) {
    const directory = await NodeFSP.realpath(
      path === "~"
        ? NodeOS.homedir()
        : path.startsWith("~/")
          ? NodePath.join(NodeOS.homedir(), path.slice(2))
          : path,
    );
    if (!NodePath.isAbsolute(path) && !path.startsWith("~/") && path !== "~")
      throw new Error("Choose an absolute directory path.");
    if (!(await NodeFSP.stat(directory)).isDirectory())
      throw new Error("Choose directories, not files.");
    directories.push(directory);
  }
  return [...new Set(directories)]
    .sort()
    .filter(
      (directory, _, all) =>
        !all.some((parent) => parent !== directory && pathIsWithin(parent, directory)),
    );
}

export function workspaceDirectoriesForSubject(subject: string): ReadonlyArray<string> | undefined {
  if (!subject.startsWith("chat-user:")) return undefined;
  const [, , marker, encoded, ...extra] = subject.split(":");
  if (marker === undefined) return undefined; // Existing unrestricted private accounts remain compatible.
  if (marker !== "directories" || !encoded || extra.length > 0) return [];
  try {
    const value: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return Array.isArray(value) &&
      value.length > 0 &&
      value.length <= 32 &&
      value.every((p) => typeof p === "string" && NodePath.isAbsolute(p))
      ? value
      : [];
  } catch {
    return [];
  }
}

export function privateWorkspaceSubject(
  userId: string,
  directories?: ReadonlyArray<string>,
): string {
  return `chat-user:${userId}${directories === undefined ? "" : `:directories:${Buffer.from(JSON.stringify(directories)).toString("base64url")}`}`;
}

export const canAccessWorkspacePath = (path: string, directories: ReadonlyArray<string>) =>
  Effect.tryPromise({
    try: async () => {
      const canonical = await canonicalWorkspacePath(path);
      return directories.some((root) => pathIsWithin(root, canonical));
    },
    catch: () => false,
  }).pipe(Effect.orElseSucceed(() => false));

export const requireWorkspacePath = Effect.fn("PrivateWorkspaces.requirePath")(function* (
  path: string,
  roots?: ReadonlyArray<string>,
) {
  const directories = roots ?? (yield* CurrentWorkspaceDirectories);
  if (directories === undefined) return;
  if (!(yield* canAccessWorkspacePath(path, directories)))
    return yield* new EnvironmentAuthorizationError({
      requiredScope: AuthFilesystemReadScope,
      message: "This directory is not shared with your account. Choose an allowed workspace.",
    });
});

export const filterWorkspaceProjects = Effect.fn("PrivateWorkspaces.filterProjects")(function* <
  A extends { readonly workspaceRoot: string },
>(projects: ReadonlyArray<A>) {
  const directories = yield* CurrentWorkspaceDirectories;
  return directories === undefined
    ? projects
    : yield* Effect.filter(projects, (project) =>
        canAccessWorkspacePath(project.workspaceRoot, directories),
      );
});

export function workspaceSessionFields(subject: string): {
  readonly allowedDirectories?: ReadonlyArray<string>;
} {
  const directories = workspaceDirectoriesForSubject(subject);
  return directories === undefined ? {} : { allowedDirectories: directories };
}

export const encodeWorkspaceDirectories = (directories: ReadonlyArray<string>) =>
  JSON.stringify(directories);
export function parseThreadDirectoryGrants(payload: string): ReadonlyArray<string> | undefined {
  try {
    const value = JSON.parse(payload) as { allowedDirectories?: unknown };
    return Array.isArray(value.allowedDirectories) &&
      value.allowedDirectories.every((p) => typeof p === "string")
      ? value.allowedDirectories
      : undefined;
  } catch {
    return undefined;
  }
}
