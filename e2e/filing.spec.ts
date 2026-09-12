import { test, expect } from '@playwright/test';
import { fakeDrive, connectDrive } from './drive-fixture';

test('スマホの同期入口から保存・バックアップの導線へ進める', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Googleに接続して同期', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '同期・復元の詳細', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '帳簿を保存。どの端末でも続きから。' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'バックアップ履歴・復元', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('申告準備の記録が年度をまたいで混ざらず、再起動後も保持される', async ({ page }) => {
  await page.goto('/?demo=1#filing');
  const section = page
    .locator('.filing-item')
    .filter({ has: page.getByText('売上・入金・源泉徴収', { exact: true }) });
  await section.getByRole('button', { name: '未確認・記録する' }).click();
  await page.getByRole('combobox', { name: '準備状況', exact: true }).selectOption('ready');
  await page
    .getByLabel('確認した資料・根拠・保管場所', { exact: true })
    .fill('架空の明細と照合済み');
  await page.getByRole('button', { name: '記録を保存', exact: true }).click();
  await expect(section.getByRole('button', { name: '確認済み', exact: true })).toBeVisible();
  const year = await page.getByRole('combobox', { name: '会計年度' }).inputValue();
  await page.reload();
  await expect(section.getByRole('button', { name: '確認済み', exact: true })).toBeVisible();
  const other = await page
    .getByRole('combobox', { name: '会計年度' })
    .locator('option')
    .evaluateAll(
      (els, current) => els.map((el) => (el as HTMLOptionElement).value).find((v) => v !== current),
      year,
    );
  if (other) {
    await page.getByRole('combobox', { name: '会計年度' }).selectOption(other);
    await expect(section.getByRole('button', { name: '未確認・記録する' })).toBeVisible();
  }
  await expect(page.getByRole('link', { name: '作成コーナーで取得する' })).toHaveAttribute(
    'href',
    /keisan\.nta\.go\.jp/,
  );
});
test('固定資産から定額法の下書きを作り、重複計上せず確定へ進む', async ({ page }) => {
  await page.goto('/#assets');
  await page.getByRole('button', { name: '資産を登録・引継ぎ' }).click();
  await page.getByLabel('資産名', { exact: true }).fill('自動計算の架空PC');
  await page.getByLabel('取得価額（円）', { exact: true }).fill('200001');
  await page.getByLabel('取得日', { exact: true }).fill('2026-04-20');
  await page.getByLabel('事業供用日（実際に使い始めた日）', { exact: true }).fill('2026-04-20');
  await page.getByLabel('用途・耐用年数・割合の根拠', { exact: true }).fill('架空の検証資料');
  await page.getByRole('button', { name: '確認した内容で資産を登録', exact: true }).click();
  await page.getByRole('button', { name: '償却を計算・登録', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('37,501');
  await page
    .getByRole('checkbox', { name: '供用月数・耐用年数・事業割合・前年末簿価を確認しました' })
    .check();
  await page.getByRole('button', { name: '根拠を保存して下書き作成', exact: true }).click();
  await expect(page.getByRole('button', { name: '下書きを確認・確定', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '償却を計算・登録', exact: true })).toHaveCount(0);
});
test('申告補足明細もDrive経由で別端末に復元される', async ({ browser }) => {
  const cloud = fakeDrive(),
    a = await browser.newContext(),
    b = await browser.newContext();
  await cloud.attach(a);
  await cloud.attach(b);
  const first = await a.newPage();
  await first.goto('/');
  await connectDrive(first);
  await first.goto('/#filing');
  await first.getByRole('button', { name: '補足明細を追加', exact: true }).click();
  await first.getByLabel('支払者・受取人・項目名').fill('同期テスト用の架空取引先');
  await first.getByLabel('金額（円・収入なら源泉徴収前）').fill('100000');
  await first.getByRole('button', { name: '補足明細を保存', exact: true }).click();
  await first.getByRole('button', { name: '今すぐ同期', exact: true }).click();
  await expect(first.getByText('Google Driveに保存済み', { exact: true })).toBeVisible();
  const second = await b.newPage();
  await second.goto('/');
  await connectDrive(second);
  await second.goto('/#filing');
  await expect(second.getByText('同期テスト用の架空取引先', { exact: true })).toBeVisible();
  await a.close();
  await b.close();
});
