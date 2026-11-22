/** The backend's helper commands need the same boundary as native agent shell tools. */
export function privateWorkspaceCommand(input: {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly directories: ReadonlyArray<string>;
  readonly cwd: string;
  readonly bwrapDirectory: string;
}) {
  return {
    command: `${input.bwrapDirectory}/bwrap`,
    args: [
      "--die-with-parent",
      "--new-session",
      "--unshare-user",
      "--unshare-pid",
      "--unshare-ipc",
      "--unshare-uts",
      "--cap-drop",
      "ALL",
      "--tmpfs",
      "/",
      "--ro-bind",
      "/usr",
      "/usr",
      "--ro-bind",
      "/bin",
      "/bin",
      "--ro-bind",
      "/lib",
      "/lib",
      "--ro-bind",
      "/lib64",
      "/lib64",
      "--ro-bind",
      "/etc",
      "/etc",
      "--ro-bind",
      "/sbin",
      "/sbin",
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      "--tmpfs",
      "/tmp",
      ...input.directories.flatMap((path) => ["--bind", path, path]),
      "--clearenv",
      "--setenv",
      "PATH",
      "/usr/local/bin:/usr/bin:/bin",
      "--setenv",
      "HOME",
      "/nonexistent",
      "--setenv",
      "LANG",
      "C.UTF-8",
      "--chdir",
      input.cwd,
      "--",
      input.command,
      ...input.args,
    ],
  };
}
