import { AuthFilesystemReadScope, type EnvironmentId } from "@t3tools/contracts";
import type { FileTree as PierreFileTree } from "@pierre/trees";
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
  set: "minimal" as const,
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
  const allProjects = useProjects();
  const projects = useMemo(
    () => allProjects.filter((project) => project.environmentId === environmentId),
    [allProjects, environmentId],
  );
  const canBrowse = useEnvironmentScope(environmentId, AuthFilesystemReadScope);
  const [path, setPath] = useState("");
  const [loadedDirectoryChildren, setLoadedDirectoryChildren] = useState<ReadonlyArray<string>>([]);
  const [emptyDirectories, setEmptyDirectories] = useState<ReadonlyArray<string>>([]);
  const valueRef = useRef(value);
  valueRef.current = value;
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
  const projectRoots = useMemo(
    () => [...new Set(projects.map((project) => project.workspaceRoot).filter(Boolean))],
    [projects],
  );
  const directories = [
    ...new Set(
      [
        ...value,
        ...projects.map((project) => project.workspaceRoot),
        ...loadedDirectoryChildren,
        ...(query.data?.entries.map((entry) => entry.fullPath) ?? []),
      ]
        .filter(Boolean)
        .map((directory) => directory.replace(/\/+$/u, "")),
    ),
  ].sort();
  const loadedDirectoryPathsRef = useRef(new Set<string>());
  const loadingDirectoryPathsRef = useRef(new Set<string>());
  const expandedDirectoryPathsRef = useRef(new Set<string>());
  useEffect(() => {
    setLoadedDirectoryChildren([]);
    setEmptyDirectories([]);
    loadedDirectoryPathsRef.current.clear();
    loadingDirectoryPathsRef.current.clear();
    expandedDirectoryPathsRef.current.clear();
  }, [environmentId, projectRoots]);
  const loadDirectoryChildren = async (treePath: string) => {
    if (!canBrowse || !treePath.endsWith("/")) return;
    const directory = treePath.replace(/\/+$/u, "");
    if (
      loadedDirectoryPathsRef.current.has(directory) ||
      loadingDirectoryPathsRef.current.has(directory)
    ) {
      return;
    }
    loadingDirectoryPathsRef.current.add(directory);
    let result;
    try {
      result = await runBrowseRef.current({
        environmentId,
        input: { partialPath: `${directory}/` },
      });
    } catch {
      return;
    } finally {
      loadingDirectoryPathsRef.current.delete(directory);
    }
    if (result._tag !== "Success") return;
    loadedDirectoryPathsRef.current.add(directory);
    const children = result.value.entries
      .map((entry) => entry.fullPath?.replace(/\/+$/u, ""))
      .filter((entry): entry is string => Boolean(entry));
    if (children.length === 0) {
      setEmptyDirectories((current) =>
        current.includes(directory) ? current : [...current, directory],
      );
      return;
    }
    setLoadedDirectoryChildren((current) => [...new Set([...current, ...children])].sort());
  };
  const toggle = (directory: string, checked: boolean) =>
    onChange(
      checked
        ? [...new Set([...valueRef.current, directory])]
        : valueRef.current.filter((candidate) => candidate !== directory),
    );
  const treePathByModelPath = useMemo<Map<string, string>>(
    () => {
      const result = new Map<string, string>();
      const emptyDirectorySet = new Set(emptyDirectories);
      const normalizedDirectories = directories.map((directory) => ({
        directory,
        modelPath: directory.replace(/^\/+|\/+$/gu, ""),
      }));
      for (const { directory, modelPath } of normalizedDirectories) {
        result.set(emptyDirectorySet.has(directory) ? modelPath : `${modelPath}/`, directory);
      }
      return result;
    },
    [directories.join("\0"), emptyDirectories.join("\0")],
  );
  const treePaths = useMemo(() => [...treePathByModelPath.keys()], [treePathByModelPath]);
  const previousTreePaths = useRef<ReadonlyArray<string> | null>(null);
  const treeModelRef = useRef<PierreFileTree | null>(null);
  const { model } = useFileTree({
    density: "compact",
    icons: PRIVATE_WORKSPACE_TREE_ICONS,
    // Populate the first tree open, then let resetPaths preserve explicit collapses.
    // With an "open" base option, Pierre treats an empty initialExpandedPaths list as "open".
    initialExpansion: "closed",
    onSelectionChange: (selectedPaths) => {
      const selected = selectedPaths.at(-1);
      const directory =
        selected === undefined
          ? undefined
          : treePathByModelPath.get(selected);
      if (directory !== undefined) toggle(directory, !valueRef.current.includes(directory));
      if (selected !== undefined) {
        queueMicrotask(() => treeModelRef.current?.getItem(selected)?.deselect());
      }
    },
    paths: [],
    renderRowDecoration: ({ row }) => {
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
  treeModelRef.current = model;
  useEffect(() => {
    let queued = false;
    let disposed = false;
    const syncExpandedDirectories = () => {
      queued = false;
      if (disposed) return;
      const expanded = expandedDirectoryPathsRef.current;
      for (const treePath of treePaths) {
        if (!treePath.endsWith("/")) continue;
        const item = model.getItem(treePath);
        if (!item?.isDirectory() || !("isExpanded" in item)) continue;
        if (item.isExpanded()) {
          expanded.add(treePath);
          void loadDirectoryChildren(treePath);
        } else if (expanded.has(treePath)) {
          for (const expandedPath of expanded) {
            if (expandedPath === treePath || expandedPath.startsWith(treePath)) {
              expanded.delete(expandedPath);
            }
          }
        }
      }
    };
    const unsubscribe = model.subscribe(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(syncExpandedDirectories);
    });
    syncExpandedDirectories();
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [model, treePaths]);
  useEffect(() => {
    if (previousTreePaths.current === treePaths) return;
    const previousPaths = previousTreePaths.current;
    const initialExpandedPaths =
      previousPaths === null
        ? []
        : treePaths.filter((treePath) => {
            return treePath.endsWith("/") && expandedDirectoryPathsRef.current.has(treePath);
          });
    previousTreePaths.current = treePaths;
    model.resetPaths(treePaths, { initialExpandedPaths });
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
        placeholder="~/"
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
