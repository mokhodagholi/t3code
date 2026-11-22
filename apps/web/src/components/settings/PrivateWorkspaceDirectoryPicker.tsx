import { AuthFilesystemReadScope, type EnvironmentId } from "@t3tools/contracts";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { T, useGT, useMessages } from "gt-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useProjects } from "../../state/entities";
import { filesystemEnvironment } from "../../state/filesystem";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { useEnvironmentScope } from "../../state/session";
import { useDebouncedValue } from "../../state/queries";
import { useTheme } from "../../hooks/useTheme";
import { T3_PIERRE_ICONS } from "../../pierre-icons";
import { PIERRE_TREE_UNSAFE_CSS, pierreTreeStyle } from "../../pierre-tree-theme";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

const PRIVATE_WORKSPACE_TREE_ICONS = {
  ...T3_PIERRE_ICONS,
  spriteSheet: T3_PIERRE_ICONS.spriteSheet.replace(
    "</svg>",
    '<symbol id="t3-private-directory-unchecked" viewBox="0 0 16 16"><rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/></symbol><symbol id="t3-private-directory-checked" viewBox="0 0 16 16"><rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2" fill="currentColor"/><path d="m4.5 8 2.2 2.2 4.8-4.8" fill="none" stroke="var(--trees-bg-override, white)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></symbol></svg>',
  ),
};

export function PrivateWorkspaceDirectoryPicker({
  environmentId,
  value,
  onChange,
  disabled,
}: {
  readonly environmentId: EnvironmentId;
  readonly value: ReadonlyArray<string>;
  readonly onChange: (value: ReadonlyArray<string>) => void;
  readonly disabled: boolean;
}) {
  const gt = useGT();
  const { resolvedTheme } = useTheme();
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const canBrowse = useEnvironmentScope(environmentId, AuthFilesystemReadScope);
  const [path, setPath] = useState("~/");
  const [discoveredDirectories, setDiscoveredDirectories] = useState<ReadonlyArray<string>>([]);
  const queryPath = useDebouncedValue(path, 200);
  const runBrowse = useAtomQueryRunner(filesystemEnvironment.browse, {
    reportFailure: false,
    reportDefect: false,
  });
  const runBrowseRef = useRef(runBrowse);
  runBrowseRef.current = runBrowse;
  const query = useEnvironmentQuery(
    canBrowse && queryPath.trim()
      ? filesystemEnvironment.browse({ environmentId, input: { partialPath: queryPath } })
      : null,
    useMessages(),
  );
  const directories = [
    ...new Set([
      ...value,
      ...projects.map((project) => project.workspaceRoot),
      ...discoveredDirectories,
      ...(query.data?.entries.map((entry) => entry.fullPath) ?? []),
    ]),
  ].sort();
  useEffect(() => {
    if (!canBrowse) return;
    let cancelled = false;
    const roots = [
      ...new Set([
        ...projects.map((project) => project.workspaceRoot),
        ...value,
        ...(query.data?.entries.map((entry) => entry.fullPath) ?? []),
      ]),
    ].filter(Boolean);
    void (async () => {
      const seen = new Set<string>();
      const queue = roots.map((root) => ({ path: root.replace(/\/+$/u, ""), depth: 0 }));
      const found: string[] = [];
      while (queue.length > 0 && seen.size < 512 && !cancelled) {
        const current = queue.shift();
        if (!current || seen.has(current.path) || current.depth >= 8) continue;
        seen.add(current.path);
        const result = await runBrowseRef.current({
          environmentId,
          input: { partialPath: `${current.path}/` },
        });
        if (result._tag !== "Success") continue;
        for (const entry of result.value.entries) {
          if (!entry.fullPath || found.includes(entry.fullPath)) continue;
          found.push(entry.fullPath);
          queue.push({ path: entry.fullPath, depth: current.depth + 1 });
        }
      }
      if (!cancelled) setDiscoveredDirectories(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [canBrowse, environmentId, projects, query.data?.entries, value]);
  const toggle = (directory: string, checked: boolean) =>
    onChange(
      checked
        ? [...new Set([...value, directory])]
        : value.filter((candidate) => candidate !== directory),
    );
  const treePathByModelPath = useMemo<Map<string, string>>(
    () =>
      new Map(
        directories.map((directory) => {
          const modelPath = directory.replace(/^\/+/, "");
          return [`${modelPath.replace(/\/$/u, "")}/`, directory] as const;
        }),
      ),
    [directories.join("\0")],
  );
  const treePaths = useMemo(() => [...treePathByModelPath.keys()], [treePathByModelPath]);
  const previousTreePaths = useRef<ReadonlyArray<string> | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const { model } = useFileTree({
    density: "compact",
    icons: PRIVATE_WORKSPACE_TREE_ICONS,
    initialExpansion: "open",
    onSelectionChange: (selectedPaths) => {
      const selected = selectedPaths.at(-1);
      const directory =
        selected === undefined
          ? undefined
          : treePathByModelPath.get(selected.endsWith("/") ? selected : `${selected}/`);
      if (directory !== undefined) toggle(directory, !valueRef.current.includes(directory));
    },
    paths: [],
    renderRowDecoration: ({ row }) => {
      if (row.kind !== "directory") return null;
      const directory = treePathByModelPath.get(row.path);
      if (directory === undefined) return null;
      return {
        icon: valueRef.current.includes(directory)
          ? "t3-private-directory-checked"
          : "t3-private-directory-unchecked",
        title: valueRef.current.includes(directory) ? gt("Allowed") : gt("Not allowed"),
      };
    },
    search: false,
    unsafeCSS: PIERRE_TREE_UNSAFE_CSS,
  });
  useEffect(() => {
    if (previousTreePaths.current === treePaths) return;
    previousTreePaths.current = treePaths;
    model.resetPaths(treePaths);
  }, [model, treePaths]);
  useEffect(() => {
    model.setComposition(model.getComposition());
  }, [model, value]);
  const selectAll = () => onChange(directories.slice(0, 32));
  const reset = () => onChange([]);
  return (
    <section className="space-y-2" aria-label={gt("Allowed directories")}>
      <h3 className="text-xs font-medium">
        <T>Allowed directories</T>
      </h3>
      <p className="text-xs text-muted-foreground">
        <T>Click folder rows to toggle access. Subfolders are included.</T>
      </p>
      <Input
        aria-label={gt("Browse owner directories")}
        value={path}
        onChange={(event) => setPath(event.target.value)}
        disabled={disabled || !canBrowse}
      />
      {query.data ? (
        <Button
          size="xs"
          variant="outline"
          disabled={disabled}
          onClick={() => toggle(query.data!.parentPath, !value.includes(query.data!.parentPath))}
        >
          <T>Select current directory</T>
        </Button>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="xs"
          variant="outline"
          disabled={disabled || directories.length === 0 || directories.length > 32}
          onClick={selectAll}
        >
          <T>Select all</T>
        </Button>
        <Button size="xs" variant="ghost" disabled={disabled || value.length === 0} onClick={reset}>
          <T>Reset</T>
        </Button>
      </div>
      {directories.length > 32 ? (
        <p className="text-xs text-muted-foreground">
          <T>
            There are more than 32 directories. Select them individually or browse a narrower
            folder.
          </T>
        </p>
      ) : null}
      <div className="h-48 overflow-y-auto rounded-md border border-input p-1">
        <FileTree
          model={model}
          aria-label={gt("Owner directories")}
          className="block min-h-20"
          style={pierreTreeStyle(resolvedTheme)}
        />
      </div>
      {value.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          <T>Select at least one directory for this private account.</T>
        </p>
      ) : null}
      {query.error ? (
        <p role="alert" className="text-xs text-destructive">
          {query.error}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        <T>
          Directory-limited chats use Codex. Host terminals and external agent tools are
          unavailable.
        </T>
      </p>
    </section>
  );
}
