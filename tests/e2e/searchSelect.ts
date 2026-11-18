import { expect, type Locator, type Page } from '@playwright/test';

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The trigger button of a searchable dropdown (`SearchSelect`), named "<label>: <selected option>". */
export const searchSelect = (scope: Page | Locator, label: string) => scope.getByRole('button', { name: new RegExp(`^${escape(label)}: `) });

/** The open list of a searchable dropdown; it opens in a layer on the page, outside dialogs and panels. */
export const searchSelectList = (page: Page, label: string) => page.getByRole('listbox', { name: label, exact: true });

/** Opens a searchable dropdown, optionally types a search, and picks an option by its text. */
export async function choose(page: Page, scope: Page | Locator, label: string, option: string | RegExp, query?: string) {
  await searchSelect(scope, label).click();
  if (query !== undefined) await page.getByRole('combobox', { name: `Search ${label.toLowerCase()}`, exact: true }).fill(query);
  await searchSelectList(page, label).getByRole('option', { name: option }).first().click();
  await expect(searchSelectList(page, label)).toHaveCount(0);
}

/** The option texts of a searchable dropdown, read by opening it and closing it again. */
export async function optionTexts(page: Page, scope: Page | Locator, label: string) {
  await searchSelect(scope, label).click();
  const texts = await searchSelectList(page, label).getByRole('option').allInnerTexts();
  await page.keyboard.press('Escape');
  await expect(searchSelectList(page, label)).toHaveCount(0);
  return texts.map(text => text.trim());
}
