import { test, expect, type Page } from '@playwright/test';
import { fakeDrive, connectDrive } from './drive-fixture';
async function history(
  page: Page,
  book: 'business' | 'misc',
  year: number,
  revenue: number,
  expense: number,
) {
  await page.goto(`/?book=${book}#settings`);
  await page
    .locator('.card')
    .filter({ has: page.getByRole('heading', { name: '会計年度・過年度の移行', exact: true }) })
    .locator('input[type=file]')
    .setInputFiles({
      name: 'synthetic.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          schema_version: '1.0',
          book,
          year,
          data_completeness: 'summary_only',
          summary: { revenue, expense },
        }),
      ),
    });
  await page.getByRole('button', { name: '確認して取り込む', exact: true }).click();
  await expect(page.getByText('過年度を閲覧専用で取り込みました', { exact: true })).toBeVisible();
}
test('スマホで両所得を合算し、年次と未集計の月次を切り替える', async ({ page }) => {
  await history(page, 'business', 2024, 200000, 100000);
  await history(page, 'misc', 2024, 500000, 300000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?book=misc#comparison');
  await page.getByLabel('比較の開始日').fill('2024-01-01');
  await page.getByLabel('比較の終了日').fill('2024-12-31');
  const table = page.getByRole('table', { name: '期間別の所得比較' });
  await expect(table).toContainText('300,000');
  await expect(table).toContainText('700,000');
  await page.getByRole('checkbox', { name: '事業所得', exact: true }).uncheck();
  await expect(table).toContainText('200,000');
  await expect(table).not.toContainText('700,000');
  await page.getByLabel('推移の単位').selectOption('month');
  await expect(table).toContainText('未集計');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('所得ごとの活動を適用年付きで保存する', async ({ page }) => {
  await page.goto('/?book=misc#settings');
  await page.getByRole('button', { name: '活動を追加', exact: true }).click();
  await page.getByLabel('活動名', { exact: true }).fill('架空の研究活動');
  await page.getByLabel('活動の開始年').fill('2024');
  await page.getByLabel('活動の終了年（継続中は空欄）').fill('2025');
  await page.getByLabel('具体的な仕事内容・活動内容').fill('架空機関からの調査依頼');
  await page.getByRole('button', { name: '活動情報を保存', exact: true }).click();
  await expect(page.getByText('活動情報を保存しました', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('架空の研究活動', { exact: true })).toBeVisible();
  await page.goto('/?book=business#settings');
  await expect(page.getByText('架空の研究活動', { exact: true })).toHaveCount(0);
});
test('Driveは共通の年度フォルダで末端だけ所得を分ける', async ({ page, context }) => {
  const cloud = fakeDrive();
  await cloud.attach(context);
  await page.goto('/?book=business');
  await connectDrive(page);
  await page.getByRole('button', { name: '今すぐ同期', exact: true }).click();
  await expect(page.getByText('Drive同期が完了しました', { exact: true })).toBeVisible();
  await page.goto('/?book=misc');
  await connectDrive(page);
  await page.getByRole('button', { name: '今すぐ同期', exact: true }).click();
  await expect(page.getByText('Drive同期が完了しました', { exact: true })).toBeVisible();
  const files = [...cloud.files.values()],
    roots = files.filter((f) => f.name === '青色コンパス');
  expect(roots).toHaveLength(1);
  const years = files.filter((f) => f.name === '2026' && f.parents.includes(roots[0].id));
  expect(years).toHaveLength(1);
  const inbox = files.find((f) => f.name === '00_未処理' && f.parents.includes(years[0].id));
  expect(
    files
      .filter((f) => f.parents.includes(inbox.id))
      .map((f) => f.name)
      .sort(),
  ).toEqual(['事業所得', '雑所得']);
});
test('申告後ファイルはDriveへの書込・読出しを確認して記録する', async ({ page, context }) => {
  const cloud = fakeDrive();
  await cloud.attach(context);
  await page.goto('/');
  await connectDrive(page);
  await page.goto('/#filing');
  const row = page.locator('section.filing-item').filter({ hasText: 'e-Tax受信通知（受付結果）' });
  await row.getByRole('button', { name: 'ファイルを登録', exact: true }).click();
  await page
    .getByRole('dialog')
    .locator('input[type=file]')
    .setInputFiles({
      name: 'synthetic-notification.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('synthetic test notification'),
    });
  await page
    .getByRole('checkbox', { name: '対象年度・本人・送信した版と内容を確認しました' })
    .check();
  await page.getByLabel('確認内容・該当なしの理由').fill('架空の受付番号と対象年度を確認');
  await page.getByRole('button', { name: '保存・読み出しを確認して登録', exact: true }).click();
  await expect(row).toContainText('保存確認済み');
  await page.reload();
  await expect(row).toContainText('synthetic-notification.pdf');
});
test('固定資産は現在を初期表示し、実績台帳と参考計算を区別する', async ({ page }) => {
  const doc = {
    id: 'asset-source',
    year: 2025,
    book: 'business',
    name: '架空固定資産台帳.pdf',
    category: '固定資産',
    original_path: 'synthetic',
    drive_url: 'https://drive.google.com/file/d/synthetic/view',
    sha256: 'a'.repeat(64),
    text: '',
    note: '',
  };
  const ref = {
    id: 'asset-2025',
    source_id: doc.id,
    year: 2025,
    book: 'business',
    name: '架空カメラ',
    acquisition_date: '2025-04-01',
    acquisition_cost: 200000,
    useful_life_years: 4,
    in_service_date: '2025-04-01',
    business_use_ratio: 100,
    opening_book_value: null,
    depreciation_amount: 37500,
    business_amount: 37500,
    closing_book_value: 162500,
    reference_only: false,
    note: '架空の検証資料',
  };
  await page.goto('/#archive');
  await page.locator('input[type=file]').setInputFiles({
    name: 'synthetic-assets.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        schema_version: '1.0',
        title: '架空台帳',
        folder_url: 'https://drive.google.com/drive/folders/synthetic',
        documents: [doc],
        issues: [],
        asset_references: [
          ref,
          {
            ...ref,
            id: 'asset-2026',
            year: 2026,
            reference_only: true,
            closing_book_value: 112500,
          },
        ],
      }),
    ),
  });
  await page.getByRole('button', { name: 'この台帳を登録', exact: true }).click();
  await page.goto('/#assets');
  await expect(page.getByLabel('固定資産の履歴年度')).toHaveValue('2026');
  await expect(page.getByRole('table', { name: '原台帳の固定資産一覧' })).toContainText('2025年末');
  await page.getByText('2年分を表示', { exact: true }).click();
  await expect(page.getByText('2026年 参考計算・実績ではありません')).toBeVisible();
  await page.getByRole('button', { name: '供用日を確認して引継ぎ', exact: true }).click();
  await expect(page.getByLabel('事業供用日（実際に使い始めた日）')).toHaveValue('2025-04-01');
});
