import React from 'react';

// 顧客ロード経路(起動→認証→ルート→入場→コンテンツ)で共通に使う全画面ローディング。
// index.html の起動ローダー(#app-boot-loader)と「同じ位置・同じデザイン」に揃えることで、
// 初回ロード中にスピナーがブレず・途切れず1つに見えるようにする。
// デザイン: 全画面中央 / 白背景 / 34px のグレー円スピナー(border top を濃いグレー)。
const AppLoading = () => (
  <div className="fixed inset-0 flex items-center justify-center bg-white">
    <div className="h-[34px] w-[34px] animate-spin rounded-full border-[3px] border-gray-200 border-t-gray-400" />
  </div>
);

export default AppLoading;
