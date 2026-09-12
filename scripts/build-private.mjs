import { spawnSync } from 'node:child_process';
for (const args of [
  ['node_modules/typescript/bin/tsc', '-b'],
  ['node_modules/vite/bin/vite.js', 'build'],
]) {
  const result = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    env: { ...process.env, VITE_PRIVATE_HOST: '1', VITE_BASE_PATH: '/' },
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
