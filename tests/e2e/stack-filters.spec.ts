import { expect, test } from '@playwright/test';
import { openBlock } from './blocks';
import { savedWorkspace } from './savedWorkspace';
import { choose } from './searchSelect';

test('components list stack tags, and a selected stack shows and edits its filter as rules', async ({ page }) => {
  await page.goto('/');
  // Stack tags are chips in the Behavior tab.
  await page.getByRole('button', { name: 'Edit Amber token', exact: true }).click();
  await page.locator('.inspector-tabs').getByRole('button', { name: 'Behavior', exact: true }).click();
  await openBlock(page, 'Stack tags');
  const tags = page.getByRole('group', { name: 'Stack tags', exact: true });
  await expect(tags.locator('.tag-chip')).toHaveText(['amber']);
  await tags.getByRole('textbox', { name: 'Add stack tags', exact: true }).fill('gold');
  await tags.getByRole('textbox', { name: 'Add stack tags', exact: true }).press('Enter');
  await expect(tags.locator('.tag-chip')).toHaveText(['amber', 'gold']);
  await page.getByRole('button', { name: 'Playground', exact: true }).click();
  await expect.poll(async () => (await savedWorkspace(page)).projects[0].components.find(c => c.name === 'Amber token')!.stackTags).toEqual(['amber', 'gold']);

  // Stacking two tokens gives the stack every tag they share.
  const rows = page.locator('#playground-pieces-panel').getByRole('button', { name: /^Amber token/ });
  await rows.nth(0).click();
  await rows.nth(1).click({ modifiers: ['Control'] });
  await page.locator('.action-grid').getByRole('button', { name: /Stack selected pieces/ }).click();
  await openBlock(page, 'Stack filter');
  const filter = page.getByRole('group', { name: 'Stack filter', exact: true });
  await expect(filter.locator('.filter-summary')).toContainText('Takes amber or gold.');

  // "(amber or gold) but not white", then a second rule for silver pieces.
  await filter.getByRole('button', { name: 'Add a tag pieces must not have to rule 1', exact: true }).click();
  await filter.getByRole('textbox', { name: 'Tag pieces must not have for rule 1', exact: true }).fill('white');
  await filter.getByRole('textbox', { name: 'Tag pieces must not have for rule 1', exact: true }).press('Enter');
  await expect(filter.locator('.filter-summary')).toContainText('amber and not white or gold');
  await filter.getByRole('button', { name: 'Or pieces with…', exact: true }).click();
  await filter.getByRole('textbox', { name: 'Tag pieces must have for rule 3', exact: true }).fill('silver');
  await filter.getByRole('textbox', { name: 'Tag pieces must have for rule 3', exact: true }).press('Enter');
  // Existing tags can be picked from a dropdown with a search box.
  await choose(page, filter, 'Tag pieces must have for rule 3: existing tags', 'gold', 'go');
  await expect(filter.locator('.filter-rule')).toHaveCount(3);
  await expect.poll(async () => {
    const project = (await savedWorkspace(page)).projects[0];
    return project.instances.find(i => i.stack && project.components.find(c => c.id === i.componentId)?.name === 'Amber token')?.stackFilter;
  }).toEqual({ anyOf: [{ has: ['amber'], lacks: ['white'] }, { has: ['gold'], lacks: [] }, { has: ['silver', 'gold'], lacks: [] }] });
  await filter.getByRole('button', { name: 'Remove rule 3', exact: true }).click();
  await expect(filter.locator('.filter-rule')).toHaveCount(2);
});
