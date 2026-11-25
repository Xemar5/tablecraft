import { expect, type Page } from '@playwright/test';

/** Header menu items and the menu they're in. */
const MENU: Record<string, 'Visibility' | 'Scripting'> = {
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

/** Checks whether a header menu item is on, opening and closing its menu. */
export const expectHeaderChecked = (page: Page, item: string, checked: boolean) =>
  withMenu(page, item, () => expect(headerItem(page, item)).toHaveAttribute('aria-checked', String(checked)));
