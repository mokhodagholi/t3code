import { AuthFilesystemReadScope, type EnvironmentId } from "@t3tools/contracts";
import { FolderOpenIcon } from "lucide-react";
import { T, useGT, useMessages } from "gt-react";
import { useState } from "react";
import { useProjects } from "../../state/entities";
import { filesystemEnvironment } from "../../state/filesystem";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { useDebouncedValue } from "../../state/queries";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";

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
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const canBrowse = useEnvironmentScope(environmentId, AuthFilesystemReadScope);
  const [path, setPath] = useState("~/");
  const queryPath = useDebouncedValue(path, 200);
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
      ...(query.data?.entries.map((entry) => entry.fullPath) ?? []),
    ]),
  ].sort();
  const toggle = (directory: string, checked: boolean) =>
    onChange(
      checked
        ? [...new Set([...value, directory])]
        : value.filter((candidate) => candidate !== directory),
    );
  const selectAll = () => onChange(directories.slice(0, 32));
  const reset = () => onChange([]);
  return (
    <section className="space-y-2" aria-label={gt("Allowed directories")}>
      <h3 className="text-xs font-medium">
        <T>Allowed directories</T>
      </h3>
      <p className="text-xs text-muted-foreground">
        <T>Choose the owner's folders this private link can use. Subfolders are included.</T>
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
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-input p-2">
        {directories.map((directory) => (
          <div key={directory} className="flex items-center gap-2">
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-xs">
              <Checkbox
                checked={value.includes(directory)}
                disabled={disabled || (!value.includes(directory) && value.length >= 32)}
                onCheckedChange={(checked) => toggle(directory, checked === true)}
              />
              <span className="break-all font-mono">{directory}</span>
            </label>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={gt("Open directory {directory}", { directory })}
              disabled={disabled || !canBrowse}
              onClick={() => setPath(`${directory.replace(/\/$/, "")}/`)}
            >
              <FolderOpenIcon className="size-3.5" />
            </Button>
          </div>
        ))}
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
