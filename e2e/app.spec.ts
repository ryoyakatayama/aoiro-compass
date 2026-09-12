import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import JSZip from 'jszip';
import { fakeDrive, connectDrive, clientId } from './drive-fixture';
test('スマホで資料台帳を検索し確認事項へ回答できる', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page, '/#archive');
  const archive = {
    schema_version: '1.0',
    title: '架空の資料',
    folder_url: 'https://drive.google.com/drive/folders/example',
    documents: [
      {
        id: 'example-doc',
        year: 2020,
        book: 'common',
        name: '架空の領収書.pdf',
        category: '領収書',
        original_path: '例/領収書.pdf',
        drive_url: 'https://drive.google.com/file/d/example/view',
        sha256: 'a'.repeat(64),
        text: '文 房 具 店',
        note: '検証用の架空データ',
      },
    ],
    issues: [
      {
        id: 'example-issue',
        year: 2020,
        book: 'common',
        title: '日付の確認',
        detail: '利用明細を確認してください',
        source_ids: ['example-doc'],
      },
    ],
  };
  await page
    .locator('input[type=file]')
    .setInputFiles({
      name: 'example.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(archive)),
    });
  await page.getByRole('button', { name: 'この台帳を登録', exact: true }).click();
  await page.getByLabel('資料名・元の場所・読み取り文字で検索').fill('文房具');
  await expect(page.locator('.archive-document').first()).toContainText('架空の領収書.pdf');
  await page.getByRole('button', { name: '確認事項（1）', exact: true }).click();
  await page.getByLabel('回答・判断の根拠').fill('利用明細で日付を確認しました');
  await page.getByLabel('確認状況').selectOption('resolved');
  await page.getByRole('button', { name: '回答を保存', exact: true }).click();
  await expect(page.getByText('確認記録を保存しました', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '確認事項（1）', exact: true }).click();
  await expect(page.getByLabel('回答・判断の根拠')).toHaveValue('利用明細で日付を確認しました');
  await expect(page.getByLabel('確認状況')).toHaveValue('resolved');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
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
  await expect(
    page.getByRole('paragraph').filter({ hasText: /^仕事専用の部屋で、面積は20%です。$/ }),
  ).toBeVisible();
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
test('DriveにSQLiteをバックアップし、コピーから復元できる', async ({ page, context }) => {
  const cloud = fakeDrive();
  await cloud.attach(context);
  await ready(page);
  await connectDrive(page);
  await page.getByRole('button', { name: 'ダッシュボード', exact: true }).click();
  await journal(page, 'バックアップ時点の経費', 2500);
  await page.getByRole('button', { name: '事業情報・設定', exact: true }).click();
  const promise = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Driveにバックアップしてコピーを保存', exact: true })
    .click();
  const download = await promise;
  const bytes = await fs.readFile((await download.path())!);
  expect(
    [...cloud.files.values()].some(
      (f) => f.appProperties?.aoiroBackup === '1' && f.bytes.equals(bytes),
    ),
  ).toBe(true);
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

test('確定済みを直接編集でき、連続入力とキーボード保存が使える', async ({ page }) => {
  await ready(page);
  await journal(page, '編集する仕訳', 1234);
  await page.getByRole('button', { name: '編集する仕訳', exact: true }).click();
  await expect(page.getByLabel('摘要（取引内容）')).toBeEditable();
  await page.getByLabel('摘要（取引内容）').fill('訂正した仕訳');
  await page.getByLabel('かんたん金額（借方・貸方へ同額入力）').fill('2500');
  await expect(
    page.getByRole('button', { name: '内容を確認して確定', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: '入力内容の訂正', exact: true }).click();
  await page.getByRole('button', { name: '確定して続けて入力', exact: true }).click();
  await expect(page.getByLabel('摘要（取引内容）')).toHaveValue('');
  await page.getByLabel('摘要（取引内容）').fill('続けて入力した仕訳');
  await page.getByLabel('かんたん金額（借方・貸方へ同額入力）').fill('3000');
  await page.getByLabel('摘要（取引内容）').press('Control+Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '訂正した仕訳', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '続けて入力した仕訳', exact: true })).toBeVisible();
});

test('未保存の編集を閉じると確認し、破棄しても確定済みの内容は変わらない', async ({ page }) => {
  await ready(page);
  await journal(page, '元の内容', 500);
  await page.getByRole('button', { name: '元の内容', exact: true }).click();
  await page.getByLabel('摘要（取引内容）').fill('保存しない内容');
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '元の内容', exact: true })).toBeVisible();
});

test('新端末と破損した端末をDriveから復旧し、事業情報も戻せる', async ({
  page,
  context,
  browser,
}) => {
  const cloud = fakeDrive();
  await cloud.attach(context);
  await ready(page);
  await journal(page, 'Driveで復旧する経費', 4321);
  await connectDrive(page);
  await page.getByLabel('業種', { exact: true }).fill('デザイン制作');
  await page.getByRole('button', { name: '事業プロフィールを保存', exact: true }).click();
  await expect(page.getByText('事業プロフィールを保存しました', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '帳簿を今すぐ同期', exact: true }).click();
  await expect(
    page.getByText('Google Driveに帳簿とバックアップを保存済みです', { exact: true }),
  ).toBeVisible();
  const origin = new URL(page.url()).origin;
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await cloud.attach(phoneContext);
  const phone = await phoneContext.newPage();
  const recover = async (target: Page) => {
    await target.goto(origin + '/?recover=1');
    await expect(
      target.getByRole('heading', { name: 'Driveから環境を復旧', exact: true }),
    ).toBeVisible();
    await target.getByLabel('Google OAuth Client ID', { exact: true }).fill(clientId);
    await target
      .getByRole('button', { name: 'Googleに接続して復旧内容を確認', exact: true })
      .click();
    await expect(target.getByText(/仕訳 1 件/)).toBeVisible();
    await target.getByLabel('確認のため「復旧」と入力').fill('復旧');
    await target.getByRole('button', { name: 'この内容で復旧する', exact: true }).click();
    await expect(target.getByLabel('業種', { exact: true })).toHaveValue('デザイン制作');
    if ((target.viewportSize()?.width || 1440) < 800)
      await target.getByRole('button', { name: 'メニューを開く', exact: true }).click();
    await target.getByRole('button', { name: 'ダッシュボード', exact: true }).click();
    await expect(
      target.getByRole('button', { name: 'Driveで復旧する経費', exact: true }),
    ).toBeVisible();
  };
  await recover(phone);
  await phone.screenshot({
    path: '../../work/recovered-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const file = await root.getFileHandle('aoiro-compass.sqlite');
    const stream = await file.createWritable();
    await stream.write('corrupted-test-cache');
    await stream.close();
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: '帳簿を開けませんでした' })).toBeVisible();
  await recover(page);
  expect(
    [...cloud.files.values()].some((f) => f.appProperties?.reason === '復旧前の端末データ'),
  ).toBe(true);
  await phoneContext.close();
});

test('Driveバックアップが失敗した場合は保存済みと表示せず、再試行できる', async ({
  page,
  context,
}) => {
  const cloud = fakeDrive();
  await cloud.attach(context);
  cloud.state.failBackups = true;
  await ready(page);
  await page.getByRole('button', { name: '事業情報・設定', exact: true }).click();
  await page.getByLabel('Google OAuth Client ID', { exact: true }).fill(clientId);
  await page.getByRole('button', { name: '設定を保存して接続', exact: true }).click();
  await expect(page.getByText(/Drive 503/)).toBeVisible();
  await expect(
    page.getByText('Google Driveに帳簿とバックアップを保存済みです', { exact: true }),
  ).toHaveCount(0);
  cloud.state.failBackups = false;
  await page.getByRole('button', { name: '帳簿を今すぐ同期', exact: true }).click();
  await expect(
    page.getByText('Google Driveに帳簿とバックアップを保存済みです', { exact: true }),
  ).toBeVisible();
});

test('画像の読取結果を科目未選択から連続確定し、貸方を事業主借に固定する', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page, '/?book=misc#evidence');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMfsAAAAASUVORK5CYII=',
    'base64',
  );
  await page.locator('input[type=file][multiple]').setInputFiles(
    [1, 2, 3].map((i) => ({
      name: `serial-${i}.png`,
      mimeType: 'image/png',
      buffer: Buffer.concat([png, Buffer.from([i])]),
    })),
  );
  await expect(page.locator('.evidence-card')).toHaveCount(3);
  for (let i = 1; i <= 3; i++)
    await page.getByLabel(`serial-${i}.pngを選択`, { exact: true }).check();
  await page.getByRole('button', { name: 'AI読取パック', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '選択した原本を書き出す', exact: true }).click();
  const zip = await JSZip.loadAsync(await fs.readFile((await (await downloadPromise).path())!));
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
  const jsonl = manifest.evidence_ids
    .map((id: string, i: number) =>
      JSON.stringify({
        schema_version: '1.0',
        evidence_id: id,
        transaction_date: `2026-09-0${i + 1}`,
        vendor: `連続読取${i + 1}`,
        gross_amount: 1000 * (i + 1),
        currency: 'JPY',
        suggested_account: '未分類',
        confidence: 0.8,
      }),
    )
    .join('\n');
  await page
    .locator('input[type=file][accept=".jsonl,.json,.txt"]')
    .setInputFiles({ name: 'read.jsonl', mimeType: 'text/plain', buffer: Buffer.from(jsonl) });
  await page.getByRole('button', { name: '領収書を連続仕訳（3件）', exact: true }).click();
  await expect(page.getByRole('button', { name: '確定して次へ', exact: true })).toBeDisabled();
  await expect(page.getByLabel('この連続処理の支払側（貸方）')).toHaveValue('3100');
  await page.getByRole('button', { name: '通信費', exact: true }).click();
  if (
    await page.getByText('この形式は表示できません。原本を別のアプリで確認してください').isVisible()
  )
    await page.getByLabel('原本を別途確認しました').check();
  await page.getByRole('button', { name: '確定して次へ', exact: true }).click();
  await expect(page.getByLabel('確認する摘要')).toHaveValue('連続読取2');
  await page.getByRole('button', { name: '保留して次へ', exact: true }).click();
  await expect(page.getByLabel('確認する摘要')).toHaveValue('連続読取3');
  await page.getByRole('button', { name: '新聞図書費', exact: true }).click();
  if (
    await page.getByText('この形式は表示できません。原本を別のアプリで確認してください').isVisible()
  )
    await page.getByLabel('原本を別途確認しました').check();
  await page.getByLabel('確認する摘要').press('Control+Enter');
  await expect(page.getByText('2件を確定しました', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '一覧に戻る', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '領収書を連続仕訳（1件）', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'メニューを開く', exact: true }).click();
  await page.getByRole('button', { name: '仕訳・記帳', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: '連続読取1' })).toContainText(
    '通信費 / 事業主借',
  );
  await expect(page.getByRole('row').filter({ hasText: '連続読取3' })).toContainText(
    '新聞図書費 / 事業主借',
  );
});

test('事業主勘定を残高表示から相殺し、実際の現金精算をワンクリックで確定する', async ({ page }) => {
  await ready(page);
  for (const [description, dr, cr, amount] of [
    ['開始時の現金', '1000', '3000', 1000],
    ['私用の支出', '1600', '1000', 300],
    ['私費で支払った経費', '5200', '3100', 600],
  ] as const) {
    await page.getByRole('button', { name: '取引を記帳', exact: true }).click();
    await page.getByLabel('摘要（取引内容）').fill(description);
    await page.getByLabel('1行目の勘定科目', { exact: true }).selectOption(dr);
    await page.getByLabel('2行目の勘定科目', { exact: true }).selectOption(cr);
    await page.getByLabel('かんたん金額（借方・貸方へ同額入力）').fill(String(amount));
    await page.getByRole('button', { name: '内容を確認して確定', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await page.getByRole('button', { name: '年度締め', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '現金精算の仕訳を確定', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'この金額で相殺を確定', exact: true }).click();
  await expect(page.getByText('事業主勘定の整理仕訳を確定しました', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'この金額で相殺を確定', exact: true }),
  ).toBeDisabled();
  await page.getByLabel('現金を動かす処理は、この日付・金額で実際に現金を授受しました').check();
  await page.getByRole('button', { name: '現金精算の仕訳を確定', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '現金精算の仕訳を確定', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: '仕訳・記帳', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: '事業主貸・事業主借の相殺' })).toContainText(
    '確定',
  );
  await expect(page.getByRole('row').filter({ hasText: '本人への現金精算' })).toContainText('確定');
});
