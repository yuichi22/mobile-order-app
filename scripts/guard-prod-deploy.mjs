// prod Hosting デプロイの門番。firebase.json の hosting.predeploy から呼ばれる。
//
// 背景(2026-09-05): 複数セッション並行開発で、作業ブランチから deploy:prod を叩くと
// ブランチHEAD全体(未承認コミットやWIP)が本番公開される事故が実際に起きた。
// 「prodはmainから」という運用ルールは口伝やメモでは全セッションに届かないため、
// デプロイ経路そのものでを機械的に止める。
//
// 緊急時の迂回: AKUTO_FORCE_PROD_DEPLOY=1 npm run deploy:prod
import { execSync } from 'node:child_process';

const project = process.env.GCLOUD_PROJECT || '';

// dev やエミュレータは素通し。プロジェクトが特定できない場合は安全側(prod扱い)に倒す。
if (project && project !== 'mobile-order-prod') process.exit(0);

if (process.env.AKUTO_FORCE_PROD_DEPLOY === '1') {
  console.warn('⚠ AKUTO_FORCE_PROD_DEPLOY=1 により prod デプロイ保護を迂回します。');
  process.exit(0);
}

const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const fail = (lines) => {
  console.error('\n🛑 prod デプロイを中止しました。');
  lines.forEach((l) => console.error('   ' + l));
  console.error('   (緊急時のみ AKUTO_FORCE_PROD_DEPLOY=1 で迂回可)\n');
  process.exit(1);
};

// ① prod は main からのみ出す
const branch = sh('git rev-parse --abbrev-ref HEAD');
if (branch !== 'main') {
  fail([
    `現在のブランチは "${branch}" です。prod は必ず main から出します。`,
    '作業ブランチのHEAD全体(未承認コミット/WIP)が本番公開されるのを防ぐためです。',
    'main にマージしてから main 上で deploy:prod してください。'
  ]);
}

// ② Hosting に載るファイルに未コミット変更があれば止める(WIP巻き込み防止)。
//    functions/ は Hosting デプロイに含まれないので対象外(他セッションのWIPを許容)。
const dirty = sh('git status --porcelain -- src public index.html vite.config.js package.json');
if (dirty) {
  fail([
    'Hosting ビルドに載るファイルに未コミットの変更があります:',
    ...dirty.split('\n').slice(0, 10).map((l) => '  ' + l),
    'コミットするか退避してから deploy:prod してください(ビルドは作業ツリーの内容で作られます)。'
  ]);
}

// ③ ローカル main が origin/main より古ければ止める(巻き戻し配信防止)。
//    fetch はしない(オフラインでも動くよう、手元が知っている origin/main とだけ比較)。
try {
  const behind = Number(sh('git rev-list --count HEAD..origin/main'));
  if (behind > 0) {
    fail([
      `ローカル main が origin/main より ${behind} コミット遅れています。`,
      'git pull してから deploy:prod してください(古いビルドで本番を巻き戻すのを防ぐため)。'
    ]);
  }
} catch {
  // origin/main が無い環境では比較しない
}

console.log(`✅ prod デプロイ保護: main / クリーン / origin と同期済み (${sh('git rev-parse --short HEAD')})`);
