import { hashPassword } from './auth.mjs';
if (!process.stdin.isTTY) throw new Error('ご自身のターミナルから実行してください');
const read = (label) =>
  new Promise((resolve) => {
    process.stdout.write(label);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    let value = '';
    const listener = (chunk) => {
      for (const c of chunk.toString('utf8')) {
        if (c === '\u0003') {
          process.stdin.setRawMode(false);
          process.exit(1);
        }
        if (c === '\r' || c === '\n') {
          process.stdin.off('data', listener);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (c === '\u007f' || c === '\b') value = value.slice(0, -1);
        else if (c >= ' ') value += c;
      }
    };
    process.stdin.on('data', listener);
  });
const first = await read('パスワード（12文字以上、非表示）: ');
if (first !== (await read('確認のためもう一度: '))) throw new Error('入力が一致しません');
console.log(
  '以下のハッシュを配信先の秘密設定 AOIRO_PASSWORD_HASH に保存してください。GitHubには保存しないでください。',
);
console.log(await hashPassword(first));
