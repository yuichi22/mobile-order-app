// ビルド時刻(vite.config.js の define で注入)。サポート時に
// 端末コンソールで window.__AKUTO_BUILD を見ればどのビルドか特定できる。
// eslint-disable-next-line no-undef
window.__AKUTO_BUILD = __AKUTO_BUILD_TIME__;

import './app/bootstrap/main.jsx'
