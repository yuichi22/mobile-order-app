import { useEffect, useRef } from 'react';

// フォーカス位置に関係なく、バーコードリーダーの読み取り(高速連続入力＋Enter終端)を
// グローバルに捕捉して onScan(value) を呼ぶフック。手入力(ゆっくり)は速度で除外。
// 入力欄にフォーカス中は手入力を壊さないよう文字を奪わない。非入力要素フォーカス時のみ横取り。
export const useGlobalBarcodeScanner = ({ active, onScan, intervalMs = 40, minLength = 3 }) => {
  const stateRef = useRef({ active, onScan });
  useEffect(() => {
    stateRef.current = { active, onScan };
  });

  useEffect(() => {
    let buffer = '';
    let bufferStart = 0; // 連続入力列の開始時刻
    let lastTime = 0;

    // Bluetoothスキャナは文字間隔が遅め(>80ms)・ばらつくため、瞬間速度ではなく
    // 「連続入力列の平均ペース」で判定する(PosMainのスキャナ判定と同方針)。
    const SCAN_GAP_MS = 300;         // この間隔以内の連続入力を1スキャンとして束ねる
    const SCAN_AVG_MS = 200;         // 列の平均文字間隔がこれ未満ならスキャナ
    const SCAN_ENTER_GRACE_MS = 500; // 末尾Enterは遅延しがちなので猶予を広めに

    const avgInterval = (endTime) => (
      buffer.length >= 2 ? (endTime - bufferStart) / (buffer.length - 1) : Infinity
    );

    const handleKeyDown = (event) => {
      const { active: isActive, onScan: handleScan } = stateRef.current;
      if (!isActive) {
        buffer = '';
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;

      // 入力欄(検索窓・バーコード欄など)にフォーカス中は、その欄自身がスキャンを
      // 取り込む(useScannerBufferedInput)。グローバル側が Enter を横取りして検索へ
      // 流したり二重処理にならないよう、編集要素フォーカス中は一切捕捉しない。
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
        buffer = '';
        return;
      }

      const now = Date.now();
      const gap = now - lastTime;
      lastTime = now;

      if (event.key === 'Enter') {
        if (buffer.length >= minLength && gap < SCAN_ENTER_GRACE_MS && avgInterval(now) < SCAN_AVG_MS) {
          event.preventDefault();
          event.stopPropagation();
          const value = buffer;
          buffer = '';
          if (typeof handleScan === 'function') handleScan(value);
        } else {
          buffer = '';
        }
        return;
      }

      if (event.key.length === 1) {
        // 新しい入力列の開始(間隔が空いた/初回)。列の平均で判定するためここでは束ねるだけ。
        if (gap > SCAN_GAP_MS || buffer === '') {
          buffer = '';
          bufferStart = now;
        }
        buffer += event.key;
        // ここに来る時点で非編集要素フォーカス(編集要素は上で return 済み)。
        // スキャナ速度と判定できたら以降の文字でページが反応しないよう横取りする。
        if (buffer.length >= 2 && avgInterval(now) < SCAN_AVG_MS) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [intervalMs, minLength]);
};

export default useGlobalBarcodeScanner;
