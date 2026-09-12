import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import JSZip from 'jszip';
async function ready(page: Page, url = '/') {
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('青色コンパス');
  await expect(page.getByText('帳簿を開けませんでした')).toHaveCount(0);
}
async function journal(page: Page, description: string, amount: number) {
  await page.getByRole('button', { name: '取引を記帳', exact: true }).click();
  await page.getByLabel('摘要（取引内容）').fill(description);
  await page.getByLabel('1行目の借方', { exact: true }).fill(String(amount));
  await page.getByLabel('2行目の貸方', { exact: true }).fill(String(amount));
  await page.getByRole('button', { name: '内容を確認して確定', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
test('事業と雑所得を分け、保存後の再表示でも混ざらない', async ({ page }) => {
  await ready(page);
  await journal(page, '事業経費テスト', 3456);
  await page.reload();
  await expect(page.getByRole('button', { name: '事業経費テスト', exact: true })).toBeVisible();
  await page.getByLabel('所得区分・帳簿を切り替え').selectOption('misc');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('雑所得も、すっきり見渡す。');
  await expect(page.getByText('事業経費テスト', { exact: true })).toHaveCount(0);
  await journal(page, '雑所得経費テスト', 7890);
  await page.getByLabel('所得区分・帳簿を切り替え').selectOption('business');
  await expect(page.getByRole('button', { name: '事業経費テスト', exact: true })).toBeVisible();
  await expect(page.getByText('雑所得経費テスト', { exact: true })).toHaveCount(0);
});
test('借貸不一致は確定できず、下書きは利益に混ぜない', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: '取引を記帳', exact: true }).click();
  await page.getByLabel('摘要（取引内容）').fill('不一致の下書き');
  await page.getByLabel('1行目の借方', { exact: true }).fill('1000');
  await page.getByLabel('2行目の貸方', { exact: true }).fill('999');
  await expect(
    page.getByRole('button', { name: '内容を確認して確定', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: '下書き保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.metric').nth(1).locator('.metric-value')).toHaveText('￥0');
  await page.getByRole('button', { name: '年度締め', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '保存して年度を締める', exact: true }),
  ).toBeDisabled();
});
test('10枚をローカル保存し、雑所得側に混ぜない', async ({ page }) => {
  await ready(page, '/?book=misc#evidence');
  const input = page.locator('input[type=file][multiple]');
  const files = Array.from({ length: 10 }, (_, i) => ({
    name: `receipt-${i}.png`,
    mimeType: 'image/png',
    buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, i]),
  }));
  await input.setInputFiles(files);
  await expect(page.locator('.evidence-card')).toHaveCount(10);
  await page.reload();
  await expect(page.locator('.evidence-card')).toHaveCount(10);
  await page.getByLabel('領収書の取込先').selectOption('business');
  await expect(page.locator('.evidence-card')).toHaveCount(0);
});
test('事業情報と本人の回答を対話パックに含め、追加回答を取り込める', async ({ page }) => {
  await ready(page, '/?demo=1#consult');
  await page.getByRole('button', { name: /自宅の仕事場：按分の根拠を整理しましょう/ }).click();
  await page.getByLabel('AIへの回答・追加質問').fill('仕事専用の部屋で、面積は20%です。');
  await page.getByRole('button', { name: '回答を保存', exact: true }).click();
  await expect(page.getByText('仕事専用の部屋で、面積は20%です。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '対話パックを確認', exact: true }).click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: '確認してZIPを保存', exact: true }).click();
  const downloaded = await dl;
  const zip = await JSZip.loadAsync(await fs.readFile((await downloaded.path())!));
  const manifest = JSON.parse(await zip.file('audit_manifest.json')!.async('text'));
  const profile = JSON.parse(await zip.file('business_profile.json')!.async('text'));
  const conversation = JSON.parse(await zip.file('conversation.json')!.async('text'));
  expect(profile.industry).toContain('Web制作');
  expect(conversation.at(-1).content).toContain('仕事専用');
  const message = conversation.at(-1);
  const reply = {
    schema_version: '1.0',
    audit_id: manifest.audit_id,
    messages: [
      {
        message_id: crypto.randomUUID(),
        finding_id: message.finding_id,
        reply_to: message.id,
        content: '追加事実を踏まえて、専用面積の資料を整理してください。',
      },
    ],
  };
  await page
    .getByRole('dialog')
    .locator('input[type=file]')
    .setInputFiles({
      name: 'reply.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(reply)),
    });
  await expect(
    page.getByText('追加事実を踏まえて、専用面積の資料を整理してください。', { exact: true }),
  ).toBeVisible();
});
test('オフラインでアプリを再起動して記帳できる', async ({ page, context }) => {
  await ready(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.getByRole('button', { name: '取引を記帳', exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: '取引を記帳', exact: true })).toBeVisible();
  await journal(page, 'オフラインの経費', 1234);
  await page.reload();
  await expect(page.getByRole('button', { name: 'オフラインの経費', exact: true })).toBeVisible();
});
test('スマホ幅で取込先を選択でき、各画面が横にはみ出さない', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page, '/?demo=1&book=misc#evidence');
  await expect(page.getByLabel('領収書の取込先')).toHaveValue('misc');
  for (const hash of [
    'dashboard',
    'ledger',
    'evidence',
    'consult',
    'reports',
    'closing',
    'settings',
  ]) {
    await page.goto(`/?demo=1&book=misc#${hash}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await page.goto('/?demo=1&book=misc#dashboard');
  await page.screenshot({ path: 'test-results/mobile-dashboard.png', fullPage: true });
});
test('SQLiteのバックアップを復元できる', async ({ page }) => {
  await ready(page);
  await journal(page, 'バックアップ時点の経費', 2500);
  await page.getByRole('button', { name: '事業情報・設定', exact: true }).click();
  const promise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'SQLiteを保存', exact: true }).click();
  const download = await promise;
  const bytes = await fs.readFile((await download.path())!);
  await page.getByRole('button', { name: 'ダッシュボード', exact: true }).click();
  await journal(page, 'バックアップ後の経費', 8888);
  await page.getByRole('button', { name: '事業情報・設定', exact: true }).click();
  await page
    .locator('input[type=file][accept=".sqlite,.db"]')
    .setInputFiles({ name: 'backup.sqlite', mimeType: 'application/octet-stream', buffer: bytes });
  await page.getByLabel('確認のため「復元」と入力').fill('復元');
  await page.getByRole('button', { name: '帳簿を復元する', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'ダッシュボード', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'バックアップ時点の経費', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('バックアップ後の経費', { exact: true })).toHaveCount(0);
});
test('2つのタブから保存しても更新が失われない', async ({ page, context }) => {
  await ready(page);
  const other = await context.newPage();
  await ready(other);
  await Promise.all([journal(page, 'タブAの経費', 1000), journal(other, 'タブBの経費', 2000)]);
  await page.reload();
  await expect(page.getByRole('button', { name: 'タブAの経費', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'タブBの経費', exact: true })).toBeVisible();
  await other.close();
});
test('スマホで仕訳入力中に勘定科目を登録できる', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page, '/?book=misc');
  await page.getByRole('button', { name: '取引を記帳', exact: true }).click();
  await page.getByLabel('摘要（取引内容）').fill('スマホから研修費を登録');
  await page.getByText('勘定科目が見つからないとき：ここで新しく登録', { exact: true }).click();
  await page.getByLabel('追加する科目コード').fill('6800');
  await page.getByLabel('追加する勘定科目名').fill('研修費');
  await page.getByRole('button', { name: '科目を登録してこの仕訳で使う', exact: true }).click();
  await expect(page.getByLabel('1行目の勘定科目', { exact: true })).toHaveValue('6800');
  await page.getByLabel('1行目の借方', { exact: true }).fill('5000');
  await page.getByLabel('2行目の貸方', { exact: true }).fill('5000');
  await page.getByRole('button', { name: '内容を確認して確定', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'スマホから研修費を登録', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('研修費', { exact: true }).first()).toBeVisible();
});
