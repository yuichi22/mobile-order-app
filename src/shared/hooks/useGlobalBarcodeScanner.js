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
    let lastTime = 0;

    const handleKeyDown = (event) => {
      const { active: isActive, onScan: handleScan } = stateRef.current;
      if (!isActive) {
        buffer = '';
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;

      const now = Date.now();
      const gap = now - lastTime;
      lastTime = now;

      if (event.key === 'Enter') {
        if (buffer.length >= minLength && gap < intervalMs) {
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
        if (gap > intervalMs) buffer = '';
        buffer += event.key;
        const el = document.activeElement;
        const editable = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
        if (!editable) {
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
