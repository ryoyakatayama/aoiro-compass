import { test, expect } from '@playwright/test';

test('過年度の経費調整と未集計をグラフで区別する', async ({ page }) => {
  await page.goto('/#settings');
  const history = {
    schema_version: '1.0',
    year: 2020,
    data_completeness: 'summary_only',
    summary: {
      revenue: 120000,
      expense: 55000,
      monthly: [
        { month: 1, revenue: 50000, expense: 60000 },
        { month: 2, revenue: null, expense: null },
        { month: 12, revenue: 70000, expense: -5000 },
      ],
    },
  };
  await page
    .locator('.card')
    .filter({ has: page.getByRole('heading', { name: '会計年度・過年度の移行', exact: true }) })
    .locator('input[type=file]')
    .setInputFiles({
      name: 'sample-history.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(history)),
    });
  await page.getByRole('button', { name: '確認して取り込む', exact: true }).click();
  await expect(page.getByText('過年度を閲覧専用で取り込みました', { exact: true })).toBeVisible();
  await page.getByLabel('会計年度').selectOption('2020');
  await page.goto('/#dashboard');
  const chart = page.locator('svg.trend-chart');
  await expect(chart).toBeVisible();
  const bars = await chart.locator('rect').evaluateAll((rects) =>
    rects.map((r) => ({
      title: r.textContent,
      y: Number(r.getAttribute('y')),
      height: Number(r.getAttribute('height')),
    })),
  );
  const refund = bars.find((b) => b.title?.includes('12月 経費'))!;
  expect(refund.height).toBeGreaterThan(0);
  expect(refund.y + refund.height).toBeLessThanOrEqual(200.01);
  expect(bars.some((b) => b.title?.trim().startsWith('2月 '))).toBe(false);
  await page.getByRole('button', { name: '数値で見る', exact: true }).click();
  await expect(
    page.getByRole('row').filter({ has: page.getByRole('cell', { name: '2月', exact: true }) }),
  ).toContainText('未集計');
  await expect(
    page.getByRole('row').filter({ has: page.getByRole('cell', { name: '12月', exact: true }) }),
  ).toContainText('5,000');
});
