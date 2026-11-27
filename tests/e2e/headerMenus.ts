import { expect, type Page } from '@playwright/test';

/** The submenu of the header's Actions menu each panel and scripting item is in (other items are in the menu itself). */
const SUBMENU: Record<string, 'Visibility' | 'Scripting'> = {
  'Component library': 'Visibility', 'Pieces panel': 'Visibility', 'Layers panel': 'Visibility', 'Hand panel': 'Visibility',
  'Table inspector': 'Visibility', 'Designer inspector': 'Visibility', Scripts: 'Scripting', Memory: 'Scripting',
};

/** The header's menu button (every item is in its Actions menu, some in a submenu). */
export const headerMenu = (page: Page, _item?: string) => page.getByRole('button', { name: 'Actions', exact: true });
export const headerItem = (page: Page, item: string) => page.getByRole('menuitemcheckbox', { name: item, exact: true });

/** Opens the Actions menu, and the submenu the item is in. */
export async function openHeaderMenu(page: Page, item: string) {
  const trigger = headerMenu(page);
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  const submenu = SUBMENU[item];
  if (submenu) await page.getByRole('menuitem', { name: submenu, exact: true }).click();
}

/** Closes the menu with Escape (a submenu first), as a keyboard user would. */
export async function closeHeaderMenu(page: Page) {
  const trigger = headerMenu(page);
  for (let n = 0; n < 3 && await trigger.getAttribute('aria-expanded') === 'true'; n++) await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
}

async function withMenu<T>(page: Page, item: string, act: () => Promise<T>) {
  await openHeaderMenu(page, item);
  const result = await act();
  await headerItem(page, item).focus();
  await closeHeaderMenu(page);
  return result;
}

/** Opens the item's header menu, toggles the item and closes the menu again. */
export const toggleHeader = (page: Page, item: string) => withMenu(page, item, () => headerItem(page, item).click());

/** Opens the item's header menu and chooses an action item (which closes the menu). */
export async function chooseHeader(page: Page, item: string) {
  await openHeaderMenu(page, item);
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

/** Checks whether a header action (such as Undo) can be chosen now, opening and closing its menu. */
export async function expectHeaderEnabled(page: Page, item: string, enabled: boolean) {
  await openHeaderMenu(page, item);
  const entry = page.getByRole('menuitem', { name: item, exact: true });
  if (enabled) await expect(entry).not.toHaveAttribute('aria-disabled', 'true');
  else await expect(entry).toHaveAttribute('aria-disabled', 'true');
  await entry.focus();
  await closeHeaderMenu(page);
}

/** Checks whether a header menu item is on, opening and closing its menu. */
export const expectHeaderChecked = (page: Page, item: string, checked: boolean) =>
  withMenu(page, item, () => expect(headerItem(page, item)).toHaveAttribute('aria-checked', String(checked)));
