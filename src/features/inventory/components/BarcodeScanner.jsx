import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { Flashlight, ZoomIn } from 'lucide-react';

const PRODUCT_BARCODE_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR
];

// active が true の間、背面カメラを起動してバーコードを継続的に読み取る。
// 検出ごとに onDetected を呼ぶため、呼び出し側で重複検出のガードを行うこと。
const BarcodeScanner = ({ active, onDetected, onError }) => {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const trackRef = useRef(null);
  const [cameraError, setCameraError] = useState('');
  const [zoomCapability, setZoomCapability] = useState(null);
  const [zoomValue, setZoomValue] = useState(1);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  useEffect(() => {
    if (!active) {
      controlsRef.current?.stop();
      controlsRef.current = null;
      trackRef.current = null;
      return undefined;
    }

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, PRODUCT_BARCODE_FORMATS);
    hints.set(DecodeHintType.TRY_HARDER, true);

    const codeReader = new BrowserMultiFormatReader(hints);
    let cancelled = false;

    codeReader.decodeFromConstraints(
      {
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      },
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

      const stream = videoRef.current?.srcObject;
      const track = stream?.getVideoTracks?.()[0] || null;
      trackRef.current = track;

      const capabilities = track?.getCapabilities ? track.getCapabilities() : {};

      if (capabilities.zoom) {
        const settings = track.getSettings ? track.getSettings() : {};
        setZoomCapability({
          min: capabilities.zoom.min ?? 1,
          max: capabilities.zoom.max ?? 1,
          step: capabilities.zoom.step ?? 0.1
        });
        setZoomValue(settings.zoom ?? capabilities.zoom.min ?? 1);
      } else {
        setZoomCapability(null);
      }

      setTorchSupported(Boolean(capabilities.torch));
    }).catch((error) => {
      console.error('failed to start camera', error);
      setCameraError('カメラを起動できませんでした。カメラへのアクセスを許可してください。');
      onError?.(error);
    });

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
      trackRef.current = null;
    };
  }, [active, onDetected, onError]);

  const handleZoomChange = (event) => {
    const value = Number(event.target.value);
    setZoomValue(value);

    trackRef.current?.applyConstraints?.({ advanced: [{ zoom: value }] })
      .catch((error) => console.error('failed to apply zoom', error));
  };

  const handleToggleTorch = () => {
    const next = !torchOn;

    trackRef.current?.applyConstraints?.({ advanced: [{ torch: next }] })
      .then(() => setTorchOn(next))
      .catch((error) => console.error('failed to toggle torch', error));
  };

  if (!active) return null;

  return (
    <div className="relative overflow-hidden rounded-3xl bg-black">
      <video ref={videoRef} className="h-72 w-full object-cover" muted playsInline />

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-24 w-4/5 rounded-2xl border-2 border-white/70" />
      </div>

      {torchSupported && (
        <button
          type="button"
          onClick={handleToggleTorch}
          className={`absolute right-3 top-3 rounded-full p-2 text-white transition ${
            torchOn ? 'bg-amber-500' : 'bg-black/50'
          }`}
          aria-label="フラッシュを切り替え"
        >
          <Flashlight size={18} />
        </button>
      )}

      {zoomCapability && zoomCapability.max > zoomCapability.min && (
        <div className="absolute inset-x-4 bottom-3 flex items-center gap-2 rounded-2xl bg-black/40 px-3 py-2">
          <ZoomIn size={16} className="text-white" />
          <input
            type="range"
            min={zoomCapability.min}
            max={zoomCapability.max}
            step={zoomCapability.step}
            value={zoomValue}
            onChange={handleZoomChange}
            className="flex-1"
          />
        </div>
      )}

      {cameraError ? (
        <p className="p-4 text-center text-sm font-bold text-rose-400">{cameraError}</p>
      ) : null}
    </div>
  );
};

export default BarcodeScanner;
