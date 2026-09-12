/// <reference types="vite-plugin-pwa/client" />
import React from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { Engine, demoMode } from './lib/persistence';
import { seedDemo } from './demo';
import './styles.css';
const root = createRoot(document.getElementById('root')!);
root.render(
  <div className="boot">
    <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
    <h1>青色コンパス</h1>
    <p>この端末の帳簿を開いています…</p>
  </div>,
);
const engine = new Engine();
engine
  .init()
  .then(async () => {
    if (demoMode) await engine.write(seedDemo);
    root.render(<App engine={engine} />);
    const update = registerSW({
      onNeedRefresh() {
        window.dispatchEvent(new CustomEvent('aoiro-update', { detail: () => void update(true) }));
      },
    });
  })
  .catch((e: Error) => {
    root.render(
      <div className="boot">
        <h1>帳簿を開けませんでした</h1>
        <p>{e.message}</p>
        <p>ブラウザの保存データは削除せず、別のタブを閉じて再読み込みしてください。</p>
        <button className="button" onClick={() => location.reload()}>
          再読み込み
        </button>
      </div>,
    );
  });
