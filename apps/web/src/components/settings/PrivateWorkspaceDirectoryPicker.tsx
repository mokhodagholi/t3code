import { AuthFilesystemReadScope, type EnvironmentId } from "@t3tools/contracts";
import type { FileTree as PierreFileTree, FileTreeRowDecorationContext } from "@pierre/trees";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { T, useGT, useMessages } from "gt-react";
import { useEffect, useEffectEvent, useRef, useState, type MouseEvent } from "react";
import { useProjects } from "../../state/entities";
import { filesystemEnvironment } from "../../state/filesystem";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { useEnvironmentScope } from "../../state/session";
import { useDebouncedValue } from "../../state/queries";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useTheme } from "../../hooks/useTheme";
import { T3_PIERRE_ICONS } from "../../pierre-icons";
import { PIERRE_TREE_UNSAFE_CSS, pierreTreeStyle } from "../../pierre-tree-theme";
import { subscribeOncePerTask } from "../files/fileTreeExpansion";
import { buildFileTreePathUpdates } from "../files/fileTreePathReconciliation";
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

const PRIVATE_WORKSPACE_TREE_CSS = `${PIERRE_TREE_UNSAFE_CSS}
  [data-item-type="folder"] > [data-item-section="icon"] {
    box-sizing: content-box;
    padding: 2px;
    margin: -2px;
  }
`;

interface PrivateWorkspaceDirectoryPickerProps {
  readonly environmentId: EnvironmentId;
  readonly value: ReadonlyArray<string>;
  readonly onChange: (value: ReadonlyArray<string>) => void;
  readonly disabled: boolean;
}

export function PrivateWorkspaceDirectoryPicker(props: PrivateWorkspaceDirectoryPickerProps) {
  return <EnvironmentDirectoryPicker key={props.environmentId} {...props} />;
}

function EnvironmentDirectoryPicker({
  environmentId,
  value,
  onChange,
  disabled,
}: PrivateWorkspaceDirectoryPickerProps) {
  const gt = useGT();
  const { resolvedTheme } = useTheme();
  const allProjects = useProjects();
  const projects = allProjects.filter((project) => project.environmentId === environmentId);
  const canBrowse = useEnvironmentScope(environmentId, AuthFilesystemReadScope);
  const [path, setPath] = useState("");
  const [loadedDirectoryChildren, setLoadedDirectoryChildren] = useState<ReadonlyArray<string>>([]);
  const [emptyDirectories, setEmptyDirectories] = useState<ReadonlyArray<string>>([]);
  const queryPath = useDebouncedValue(path, 200);
  const runBrowse = useAtomQueryRunner(filesystemEnvironment.browse, {
    reportFailure: false,
    reportDefect: false,
  });
  const query = useEnvironmentQuery(
    canBrowse && queryPath.trim()
      ? filesystemEnvironment.browse({ environmentId, input: { partialPath: queryPath } })
      : null,
    useMessages(),
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
        .map((directory) => directory.replace(/\/+$/u, "") || "/"),
    ),
  ].sort();
  const loadedDirectoryPathsRef = useRef(new Set<string>());
  const loadingDirectoryPathsRef = useRef(new Set<string>());
  const browseControllerRef = useRef<AbortController | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- cancel filesystem requests when this environment picker unmounts
  useEffect(() => {
    const controller = new AbortController();
    browseControllerRef.current = controller;
    return () => controller.abort();
  }, []);
  const toggle = (directory: string, checked: boolean) =>
    onChange(
      checked
        ? [...new Set([...value, directory])]
        : value.filter((candidate) => candidate !== directory),
    );
  const treePathByModelPath = new Map<string, string>();
  const emptyDirectorySet = new Set(emptyDirectories);
  for (const directory of directories) {
    const modelPath = directory.replace(/^\/+|\/+$/gu, "");
    treePathByModelPath.set(
      emptyDirectorySet.has(directory) ? modelPath : `${modelPath}/`,
      directory,
    );
  }
  const treePaths = [...treePathByModelPath.keys()];
  const loadDirectoryChildren = useEffectEvent(async (treePath: string) => {
    const directory = treePathByModelPath.get(treePath);
    const signal = browseControllerRef.current?.signal;
    if (!canBrowse || disabled || directory === undefined || signal?.aborted) return;
    if (
      loadedDirectoryPathsRef.current.has(directory) ||
      loadingDirectoryPathsRef.current.has(directory)
    ) {
      return;
    }
    loadingDirectoryPathsRef.current.add(directory);
    const result = await runBrowse(
      { environmentId, input: { partialPath: `${directory.replace(/\/+$/u, "")}/` } },
      { signal },
    ).catch(() => null);
    loadingDirectoryPathsRef.current.delete(directory);
    if (signal?.aborted || result === null || result._tag !== "Success") return;
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
  });
  const previousTreePaths = useRef<ReadonlyArray<string> | null>(null);
  const treeModelRef = useRef<PierreFileTree | null>(null);
  const onSelectionChange = useStableCallback((selectedPaths: readonly string[]) => {
    const selected = selectedPaths.at(-1);
    const directory = selected === undefined ? undefined : treePathByModelPath.get(selected);
    if (!disabled && directory !== undefined) toggle(directory, !value.includes(directory));
    if (selected !== undefined) {
      queueMicrotask(() => treeModelRef.current?.getItem(selected)?.deselect());
    }
  });
  const renderRowDecoration = useStableCallback(({ row }: FileTreeRowDecorationContext) => {
    const directory = treePathByModelPath.get(row.path);
    if (directory === undefined) return null;
    return {
      icon: value.includes(directory)
        ? "t3-private-directory-checked"
        : "t3-private-directory-unchecked",
      title: value.includes(directory) ? gt("Allowed") : gt("Not allowed"),
    };
  });
  const { model } = useFileTree({
    density: "compact",
    flattenEmptyDirectories: false,
    icons: PRIVATE_WORKSPACE_TREE_ICONS,
    initialExpansion: "closed",
    onSelectionChange,
    paths: [],
    renderRowDecoration,
    search: false,
    unsafeCSS: PRIVATE_WORKSPACE_TREE_CSS,
  });
  const handleTreeClick = (event: MouseEvent<HTMLElement>) => {
    // Pierre's rows live in an open shadow root, so event.target is the host.
    const elements = event.nativeEvent
      .composedPath()
      .filter((entry) => entry instanceof HTMLElement);
    const row = elements.find((element) => element.dataset.itemPath !== undefined);
    const treePath = row?.dataset.itemPath;
    if (row === undefined || treePath === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    if (disabled) return;
    row.focus({ preventScroll: true });
    const item = model.getItem(treePath);
    const clickedDecoration = elements.some(
      (element) => element.dataset.itemSection === "decoration",
    );
    if (!clickedDecoration && item?.isDirectory() && "toggle" in item) {
      item.toggle();
    } else {
      const directory = treePathByModelPath.get(treePath);
      if (directory !== undefined) toggle(directory, !value.includes(directory));
    }
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- expose the imperative tree to the selection callback after mounting
  useEffect(() => {
    treeModelRef.current = model;
    return () => {
      treeModelRef.current = null;
    };
  }, [model]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- load immediate children when Pierre reports a newly expanded folder
  useEffect(() => {
    const expanded = new Set<string>();
    const loadExpanded = () => {
      for (const treePath of treePaths) {
        if (!treePath.endsWith("/")) continue;
        const item = model.getItem(treePath);
        if (!item?.isDirectory() || !("isExpanded" in item)) continue;
        if (item.isExpanded()) {
          if (!expanded.has(treePath)) {
            expanded.add(treePath);
            void loadDirectoryChildren(treePath);
          }
        } else {
          expanded.delete(treePath);
        }
      }
    };
    loadExpanded();
    return subscribeOncePerTask(model, loadExpanded);
  }, [model, treePaths]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- update Pierre paths in place so lazy results retain the user's expansion state
  useEffect(() => {
    if (previousTreePaths.current === treePaths) return;
    const previousPaths = previousTreePaths.current;
    previousTreePaths.current = treePaths;
    if (previousPaths === null) {
      model.resetPaths(treePaths);
    } else {
      const updates = buildFileTreePathUpdates(previousPaths, treePaths);
      if (updates.length > 0) model.batch(updates);
    }
  }, [model, treePaths]);
  const decoratedValueRef = useRef(value);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refresh Pierre row decorations after allowed directories change
  useEffect(() => {
    if (decoratedValueRef.current === value) return;
    decoratedValueRef.current = value;
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
          onClickCapture={handleTreeClick}
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
