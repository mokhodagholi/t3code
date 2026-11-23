import { expect } from "e2e";
import { test, WEB } from "./t3.ts";

test(
  "private workspace folders open lazily and can close again",
  WEB,
  async ({ t3, app, screen, browser }) => {
    const project = await t3.project("picker-project", {
      "child/deep/file.txt": "fixture",
      "sibling/file.txt": "fixture",
    });
    await t3.open("/settings/access");
    await screen.getByRole("button", "Create link").tap();
    await screen.getByRole("textbox", "Private chat account (optional)").fill("picker-test");
    const tree = () =>
      browser.evaluate(() =>
        Boolean(
          document.querySelector('file-tree-container[aria-label="Owner directories"]')?.shadowRoot,
        ),
      );
    await expect.poll(tree).toBe(true);
    const clickRow = (path: string) =>
      browser.evaluate((path) => {
        const tree = document.querySelector(
          'file-tree-container[aria-label="Owner directories"]',
        )?.shadowRoot;
        const row = tree?.querySelector<HTMLElement>(`[data-item-path="${path}"]`);
        row?.click();
        return Boolean(row);
      }, path);
    const hasRow = (path: string) =>
      browser.evaluate(
        (path) =>
          Boolean(
            document
              .querySelector('file-tree-container[aria-label="Owner directories"]')
              ?.shadowRoot?.querySelector(`[data-item-path="${path}"]`),
          ),
        path,
      );
    let path = "";
    for (const segment of project.split("/").filter(Boolean)) {
      path += `${segment}/`;
      await clickRow(path);
    }
    const child = `${path}child/`;
    await app.screenshot("folder-open");
    await expect.poll(() => hasRow(child)).toBe(true);
    await clickRow(child);
    await expect.poll(() => hasRow(`${child}deep/`)).toBe(true);
    await clickRow(path);
    await expect.poll(() => hasRow(child)).toBe(false);
    await clickRow(path);
    await expect.poll(() => hasRow(child)).toBe(true);
  },
);
