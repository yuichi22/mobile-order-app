// デプロイ反映チェック: ローカル dist の entry ハッシュと、ライブサイトの entry ハッシュを突き合わせる。
// 一致 = いまローカルにある build が実際に配信されている。不一致 = 配信が古い/取り残し。
// 使い方: node scripts/check-deploy.mjs dev|prod
//   (事前に該当環境向けに build 済みの dist を、そのままデプロイした後で実行する)
import { readFileSync } from 'node:fs';

const TARGETS = {
  dev: 'https://mobile-order-dev-5f7fd.web.app',
  prod: 'https://mobile-order-prod.web.app'
};

const entryOf = (html) => {
  const m = html.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/);
  return m ? m[0] : null;
};

const main = async () => {
  const env = (process.argv[2] || '').trim();
  const base = TARGETS[env];
  if (!base) {
    console.error('usage: node scripts/check-deploy.mjs dev|prod');
    process.exit(2);
  }

  const localEntry = entryOf(readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8'));
  if (!localEntry) {
    console.error('NG: dist/index.html に entry が見つかりません。先に build してください。');
    process.exit(2);
  }

  const res = await fetch(base + '/?_=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' } });
  const liveEntry = entryOf(await res.text());

  console.log(`env   : ${env} (${base})`);
  console.log(`local : ${localEntry}`);
  console.log(`live  : ${liveEntry}`);

  if (localEntry === liveEntry) {
    console.log('OK: ローカルの build が配信されています。');
    process.exit(0);
  }
  console.error('NG: 配信が一致しません（prodだけ取り残し等）。もう一度デプロイしてください。');
  process.exit(1);
};

main().catch((e) => { console.error('NG: チェック失敗:', e?.message || e); process.exit(2); });
