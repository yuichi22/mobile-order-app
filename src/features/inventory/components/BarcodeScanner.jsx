import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';

// active が true の間、背面カメラを起動してバーコードを継続的に読み取る。
// 検出ごとに onDetected を呼ぶため、呼び出し側で重複検出のガードを行うこと。
const BarcodeScanner = ({ active, onDetected, onError }) => {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const [cameraError, setCameraError] = useState('');

  useEffect(() => {
    if (!active) {
      controlsRef.current?.stop();
      controlsRef.current = null;
      return undefined;
    }

    const codeReader = new BrowserMultiFormatReader();
    let cancelled = false;

    codeReader.decodeFromConstraints(
      { video: { facingMode: 'environment' } },
      videoRef.current,
      (result) => {
        if (cancelled || !result) return;
        onDetected(result.getText());
      }
    ).then((controls) => {
      if (cancelled) {
        controls.stop();
        return;
      }
      controlsRef.current = controls;
      setCameraError('');
    }).catch((error) => {
      console.error('failed to start camera', error);
      setCameraError('カメラを起動できませんでした。カメラへのアクセスを許可してください。');
      onError?.(error);
    });

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [active, onDetected, onError]);

  if (!active) return null;

  return (
    <div className="overflow-hidden rounded-3xl bg-black">
      <video ref={videoRef} className="h-64 w-full object-cover" muted playsInline />
      {cameraError ? (
        <p className="p-4 text-center text-sm font-bold text-rose-400">{cameraError}</p>
      ) : null}
    </div>
  );
};

export default BarcodeScanner;
