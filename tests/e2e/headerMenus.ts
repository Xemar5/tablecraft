import { expect, type Page } from '@playwright/test';

/** Header menu items and the menu they're in. */
const MENU: Record<string, 'Actions' | 'Visibility' | 'Scripting'> = {
  Undo: 'Actions', Redo: 'Actions', 'Save playground': 'Actions', 'Print to PDF': 'Actions',
  'Component library': 'Visibility', 'Pieces panel': 'Visibility', 'Layers panel': 'Visibility', 'Hand panel': 'Visibility',
  'Table inspector': 'Visibility', 'Designer inspector': 'Visibility', Scripts: 'Scripting', Memory: 'Scripting',
};

export const headerMenu = (page: Page, item: string) => page.getByRole('button', { name: MENU[item], exact: true });
export const headerItem = (page: Page, item: string) => page.getByRole('menuitemcheckbox', { name: item, exact: true });

async function withMenu<T>(page: Page, item: string, act: () => Promise<T>) {
  const trigger = headerMenu(page, item);
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  const result = await act();
  await headerItem(page, item).press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  return result;
}

/** Opens the item's header menu, toggles the item and closes the menu again. */
export const toggleHeader = (page: Page, item: string) => withMenu(page, item, () => headerItem(page, item).click());

/** Opens the item's header menu and chooses an action item (which closes the menu). */
export async function chooseHeader(page: Page, item: string) {
  await headerMenu(page, item).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

/** Checks whether a header action (such as Undo) can be chosen now, opening and closing its menu. */
export async function expectHeaderEnabled(page: Page, item: string, enabled: boolean) {
  const trigger = headerMenu(page, item);
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  const entry = page.getByRole('menuitem', { name: item, exact: true });
  if (enabled) await expect(entry).not.toHaveAttribute('aria-disabled', 'true');
  else await expect(entry).toHaveAttribute('aria-disabled', 'true');
  await entry.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
}

/** Checks whether a header menu item is on, opening and closing its menu. */
export const expectHeaderChecked = (page: Page, item: string, checked: boolean) =>
  withMenu(page, item, () => expect(headerItem(page, item)).toHaveAttribute('aria-checked', String(checked)));
