// functions デプロイの門番。firebase.json の functions.predeploy から呼ばれる。
//
// 背景(2026-10-06): worktree から prod へ functions を出した際、その worktree に
// `functions/.env.<projectId>` が無く（.env は gitignore なので git には付いてこない）、
// **環境変数ゼロの関数が本番に出た**。Core を呼ぶ URL とシークレットが消え、
// レジの会員検索が「サーバー設定が不足しています」で止まった。
// 既存関数を同じ状態で出していたら、本番の決済連携が丸ごと落ちていた。
//
// Firebase CLI は env ファイルが無くても黙ってデプロイするので、ここで止める。
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const project = process.env.GCLOUD_PROJECT || '';
if (!project) process.exit(0); // プロジェクトが特定できない場合は素通し(エミュレータ等)

const envFile = join(root, 'functions', `.env.${project}`);
if (!existsSync(envFile)) {
  console.error('\n🛑 functions のデプロイを中止しました。');
  console.error(`   functions/.env.${project} がこの作業ツリーにありません。`);
  console.error('   このまま出すと環境変数ゼロの関数が公開され、Core連携が止まります。');
  console.error('   別のチェックアウトからコピーしてください:');
  console.error(`     cp <他のチェックアウト>/functions/.env* ${join(root, 'functions')}/\n`);
  process.exit(1);
}
