import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { chooseHeader } from './headerMenus';

test('Print to PDF lays out every piece at print size and prints them with their backs', async ({ page }, testInfo) => {
  await page.goto('/');
  // Record the print request instead of opening the browser's dialog.
  await page.evaluate(() => { (window as unknown as { printed: number }).printed = 0; window.print = () => { (window as unknown as { printed: number }).printed++; }; });
  await chooseHeader(page, 'Print to PDF');
  const dialog = page.getByRole('dialog', { name: 'Print to PDF' });
  // Wildwood: 15 cards, 5 tokens, the board and the die's six faces.
  await expect(dialog.getByRole('status')).toContainText('27 copies on');
  await dialog.getByRole('button', { name: 'Print or save as PDF' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);

  // The pages stay hidden on screen and are only shown by the print stylesheet.
  const pages = page.locator('.print-root .print-page');
  await expect(page.locator('.print-root')).toBeHidden();
  const fronts = await page.locator('.print-root .print-front').count();
  expect(fronts).toBeGreaterThan(0);
  await expect(page.locator('.print-root .print-back')).toHaveCount(fronts);
  await page.emulateMedia({ media: 'print' });
  await expect(pages.first()).toBeVisible();
  await expect(page.locator('.app-shell')).toBeHidden();
  // A 220 px card prints 220/96 inches wide.
  const card = page.locator('.print-front .print-item[data-component="Spirit cards"]').first();
  const width = await card.evaluate(element => element.getBoundingClientRect().width);
  expect(width).toBeCloseTo(220, 0);
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  await testInfo.attach('project.pdf', { body: pdf, contentType: 'application/pdf' });
  if (process.env.PRINT_PDF_OUT) await writeFile(process.env.PRINT_PDF_OUT, pdf);
  const text = pdf.toString('latin1');
  expect(text.match(/\/Type\s*\/Page[^s]/g)?.length).toBe(fronts * 2);
  // A4 pages: 595 × 842 points.
  const box = /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(text)!.slice(1).map(Number);
  expect(box[2] - box[0]).toBeCloseTo(595.3, 0);
  expect(box[3] - box[1]).toBeCloseTo(841.9, 0);
  // Closing the print dialog removes the pages again.
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(page.locator('.print-root')).toHaveCount(0);
});

test('pieces too big for a page are listed, and print in parts with glue wings or shrink to fit', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { window.print = () => undefined; });
  await chooseHeader(page, 'Print to PDF');
  const dialog = page.getByRole('dialog', { name: 'Print to PDF' });
  const scale = dialog.getByLabel('Scale (%)', { exact: true });
  await scale.fill('250');
  await scale.press('Enter');
  const note = dialog.locator('.print-oversized');
  await expect(note).toContainText('Forest clearing: printed in 6 parts with glue wings');
  await dialog.getByRole('checkbox', { name: /^Split large pieces/ }).uncheck();
  await expect(note).toContainText(/Forest clearing: shrunk to \d+%/);
  await dialog.getByRole('checkbox', { name: /^Split large pieces/ }).check();
  await dialog.getByRole('button', { name: 'Print or save as PDF' }).click();
  await expect(page.locator('.print-root .print-part-label')).toHaveCount(6);
  // Glue wings on the parts with a neighbour to the right (4) or below (3).
  await expect(page.locator('.print-root .print-front .print-wing-right')).toHaveCount(4);
  await expect(page.locator('.print-root .print-front .print-wing-bottom')).toHaveCount(3);
  await expect(page.locator('.print-root .print-front .print-wing-right').first()).toContainText('Glue part 2 here');
});

