import { EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { userEvent, type Locator } from "vite-plus/test/browser";
import "~/index.css";
import { act, render } from "../../../test/render";
import { PrivateWorkspaceDirectoryPicker } from "./PrivateWorkspaceDirectoryPicker";

const state = vi.hoisted(() => ({
  projects: [{ environmentId: "local", workspaceRoot: "/work/owner" }],
  browse: vi.fn(),
}));
vi.mock("../../state/entities", async (original) => ({
  ...(await original<typeof import("../../state/entities")>()),
  useProjects: () => state.projects,
}));
vi.mock("../../state/session", async (original) => ({
  ...(await original<typeof import("../../state/session")>()),
  useEnvironmentScope: () => true,
}));
vi.mock("../../state/query", async (original) => ({
  ...(await original<typeof import("../../state/query")>()),
  useEnvironmentQuery: () => ({ data: undefined }),
}));

vi.mock("../../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => state.browse }));

function Picker() {
  const [value, onChange] = useState<readonly string[]>([]);
  return (
    <PrivateWorkspaceDirectoryPicker
      environmentId={EnvironmentId.make("local")}
      value={value}
      onChange={onChange}
      disabled={false}
    />
  );
}
async function clickArrow(row: Locator) {
  await expect.element(row).toBeVisible();
  await userEvent.click(row.element().querySelector<HTMLElement>('[data-item-section="icon"]')!);
}
async function clickRow(row: Locator) {
  await expect.element(row).toBeVisible();
  await userEvent.click(row.element().querySelector<HTMLElement>('[data-item-section="content"]')!);
}
const listing = (parentPath: string, names: string[]) => ({
  _tag: "Success",
  value: {
    parentPath,
    entries: names.map((name) => ({ name, fullPath: `${parentPath}/${name}` })),
  },
});
function setup() {
  state.projects = [{ environmentId: "local", workspaceRoot: "/work/owner" }];
  state.browse
    .mockReset()
    .mockImplementation(async ({ input }: { input: { partialPath: string } }) => {
      if (input.partialPath === "/work/owner/") return listing("/work/owner", ["child", "sibling"]);
      if (input.partialPath === "/work/owner/child/") return listing("/work/owner/child", ["deep"]);
      return { _tag: "Failure" };
    });
}

it("opens folders lazily using absolute paths, preserves children across project updates, and closes/reopens", async () => {
  setup();
  await using screen = await render(<Picker />);
  await clickArrow(screen.getByRole("treeitem", { name: "work", exact: true }));
  const root = screen.getByRole("treeitem", { name: "owner", exact: true });
  await expect.element(root).toHaveAttribute("aria-expanded", "false");
  expect(state.browse).not.toHaveBeenCalled();
  await clickArrow(root);
  await expect.poll(() => state.browse.mock.calls[0]?.[0].input.partialPath).toBe("/work/owner/");
  const child = screen.getByRole("treeitem", { name: "child", exact: true });
  await expect.element(child).toBeVisible();
  await expect.element(child).toHaveAttribute("aria-expanded", "false");
  expect(state.browse).toHaveBeenCalledTimes(1);
  await clickArrow(child);
  await expect.element(screen.getByRole("treeitem", { name: "deep", exact: true })).toBeVisible();
  expect(state.browse).toHaveBeenCalledTimes(2);
  state.projects = state.projects.map((project) => ({ ...project }));
  await screen.rerender(<Picker />);
  await expect.element(screen.getByRole("treeitem", { name: "deep", exact: true })).toBeVisible();
  await clickArrow(root);
  await expect.element(root).toHaveAttribute("aria-expanded", "false");
  await expect.element(child).not.toBeInTheDocument();
  await clickArrow(root);
  await expect.element(child).toBeVisible();
  expect(state.browse).toHaveBeenCalledTimes(2);
});

it("keeps a folder closed when its pending load finishes", async () => {
  setup();
  let finish!: (value: ReturnType<typeof listing>) => void;
  state.browse.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await using screen = await render(<Picker />);
  await clickArrow(screen.getByRole("treeitem", { name: "work", exact: true }));
  const root = screen.getByRole("treeitem", { name: "owner", exact: true });
  await clickArrow(root);
  await expect.poll(() => state.browse.mock.calls.length).toBe(1);
  await clickArrow(root);
  await act(() => finish(listing("/work/owner", ["child"])));
  await expect.element(root).toHaveAttribute("aria-expanded", "false");
  await expect
    .element(screen.getByRole("treeitem", { name: "child", exact: true }))
    .not.toBeInTheDocument();
  await clickArrow(root);
  await expect.element(screen.getByRole("treeitem", { name: "child", exact: true })).toBeVisible();
  expect(state.browse).toHaveBeenCalledTimes(1);
});

it("separates arrow expansion from row selection, including the arrow padding", async () => {
  setup();
  await using screen = await render(<Picker />);
  await clickArrow(screen.getByRole("treeitem", { name: "work", exact: true }));
  const root = screen.getByRole("treeitem", { name: "owner", exact: true });
  const reset = screen.getByRole("button", { name: "Reset", exact: true });
  await clickRow(root);
  await expect.element(root).toHaveAttribute("aria-expanded", "true");
  await expect.element(reset).toBeDisabled();
  expect(state.browse).toHaveBeenCalledTimes(1);
  const checkbox = root.element().querySelector<HTMLElement>('[data-item-section="decoration"]')!;
  await userEvent.click(checkbox);
  await expect.element(reset).toBeEnabled();
  await expect.element(screen.getByText("1 directory selected", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("/work/owner", { exact: true })).toBeVisible();
  await userEvent.click(checkbox);
  await expect.element(screen.getByText("No directories selected", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("/work/owner", { exact: true })).not.toBeInTheDocument();
  await clickRow(root);
  await expect.element(root).toHaveAttribute("aria-expanded", "false");
  await expect.element(reset).toBeDisabled();
  const icon = root.element().querySelector<HTMLElement>('[data-item-section="icon"]')!;
  expect(getComputedStyle(icon).padding).toBe("2px");
  // Clicking the padded arrow area still only changes expansion.
  await userEvent.click(icon, { position: { x: 1, y: 1 } });
  const child = screen.getByRole("treeitem", { name: "child", exact: true });
  await expect.element(child).toBeVisible();
  await expect.element(reset).toBeDisabled();
  await clickRow(root);
  await expect.element(root).toHaveAttribute("aria-expanded", "false");
  await expect.element(reset).toBeDisabled();
});
