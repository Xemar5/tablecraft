import type { Page } from '@playwright/test';

/** A collapsible settings block (ui.tsx Collapsible) by its title. */
export const block = (page: Page, title: string) =>
  page.locator('details.collapsible-block').filter({ has: page.locator('.collapsible-title').getByText(title, { exact: true }) }).first();

/** Opens a collapsible settings block (they start closed), unless it's open already. */
export async function openBlock(page: Page, title: string) {
  const details = block(page, title);
  if (await details.getAttribute('open') === null) await details.locator('summary').click();
}
