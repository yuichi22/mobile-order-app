import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Palette } from 'lucide-react';

const hsvToRgb = (h, s, v) => {
  s /= 100;
  v /= 100;
  let r;
  let g;
  let b;
  const i = Math.floor(h / 60);
  const f = h / 60 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  switch (i % 6) {
    case 0:
      r = v; g = t; b = p;
      break;
    case 1:
      r = q; g = v; b = p;
      break;
    case 2:
      r = p; g = v; b = t;
      break;
    case 3:
      r = p; g = q; b = v;
      break;
    case 4:
      r = t; g = p; b = v;
      break;
    case 5:
      r = v; g = p; b = q;
      break;
    default:
      r = 0; g = 0; b = 0;
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255)
  };
};

const rgbToHsv = (r, g, b) => {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h;
  let s;
  const v = max;
  const d = max - min;

  s = max === 0 ? 0 : d / max;

  if (max === min) {
    h = 0;
  } else {
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
      default:
        h = 0;
    }
    h /= 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    v: Math.round(v * 100)
  };
};

const rgbToHex = (r, g, b) => {
  const toHex = (component) => {
    const hex = Math.max(0, Math.min(255, component)).toString(16);
    return hex.length === 1 ? `0${hex}` : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
};

const hexToRgb = (hex) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
};

const DEFAULT_PRESETS = [
  { value: '#F8B862' },
  { value: '#F39800' },
  { value: '#EE7948' },
  { value: '#655C99' }
];

const ColorPicker = ({ selectedColor, onChange, presetColors }) => {
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [hsv, setHsv] = useState({ h: 37, s: 100, v: 95 });
  const [isDraggingMap, setIsDraggingMap] = useState(false);
  const [isDraggingHue, setIsDraggingHue] = useState(false);

  const mapRef = useRef(null);
  const hueRef = useRef(null);
  const colorsToUse = presetColors || DEFAULT_PRESETS;

  const isSameColor = (left, right) => left && right && left.toUpperCase() === right.toUpperCase();

  const handleColorSelect = (hex) => {
    onChange(hex.toUpperCase());
    try {
      const rgb = hexToRgb(hex);
      setHsv(rgbToHsv(rgb.r, rgb.g, rgb.b));
    } catch (error) {
      void error;
    }
    setShowCustomPicker(false);
  };

  const resolvedHsv = (() => {
    if (!selectedColor || isDraggingMap || isDraggingHue) return hsv;

    try {
      const rgb = hexToRgb(selectedColor);
      return rgbToHsv(rgb.r, rgb.g, rgb.b);
    } catch (error) {
      void error;
      return hsv;
    }
  })();

  useEffect(() => {
    if (isDraggingMap || isDraggingHue) {
      const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
      onChange(rgbToHex(rgb.r, rgb.g, rgb.b));
    }
  }, [hsv, isDraggingMap, isDraggingHue, onChange]);

  const handleMapMove = useCallback((event) => {
    if (!mapRef.current) return;

    const rect = mapRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    setHsv((previous) => ({
      ...previous,
      s: Math.round(x * 100),
      v: Math.round((1 - y) * 100)
    }));
  }, []);

  const handleHueMove = useCallback((event) => {
    if (!hueRef.current) return;

    const rect = hueRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    setHsv((previous) => ({ ...previous, h: Math.round(x * 360) }));
  }, []);

  useEffect(() => {
    const handleUp = () => {
      setIsDraggingMap(false);
      setIsDraggingHue(false);
    };

    const handleMove = (event) => {
      if (isDraggingMap) handleMapMove(event);
      if (isDraggingHue) handleHueMove(event);
    };

    if (isDraggingMap || isDraggingHue) {
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isDraggingMap, isDraggingHue, handleMapMove, handleHueMove]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        {colorsToUse.map((color, index) => {
          const colorValue = color.value || color.hex;
          const isSelected = isSameColor(selectedColor || '', colorValue);

          return (
            <button
              key={index}
              type="button"
              onClick={() => handleColorSelect(colorValue)}
              className={`w-10 h-10 rounded-full border-4 transition-all shrink-0 ${
                isSelected
                  ? 'scale-110 border-white ring-2 ring-gray-300'
                  : 'border-transparent opacity-80 hover:opacity-100'
              }`}
              style={{
              backgroundColor: colorValue,
              boxShadow: isSelected ? `0 0 10px ${colorValue}` : 'none'
            }}
            />
          );
        })}

        <div className="h-8 w-px bg-gray-200 mx-1" />

        <button
          type="button"
          onClick={() => setShowCustomPicker(!showCustomPicker)}
          className={`w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all bg-white shrink-0 ${
            showCustomPicker || !colorsToUse.some((color) => isSameColor((color.value || color.hex), selectedColor || ''))
              ? 'border-white scale-110 shadow-lg'
              : 'border-gray-200 text-gray-400 hover:border-gray-300'
          }`}
          style={{
            color: selectedColor,
            boxShadow: (showCustomPicker || !colorsToUse.some((color) => isSameColor((color.value || color.hex), selectedColor || '')))
              ? `0 0 14px ${selectedColor}`
              : 'none'
          }}
        >
          <Palette size={20} />
        </button>
      </div>

      {showCustomPicker && (
        <div className="p-4 bg-white rounded-3xl border border-gray-200 shadow-inner space-y-4 animate-in fade-in zoom-in-95 duration-200 w-full max-w-xs">
          <div
            ref={mapRef}
            onMouseDown={(event) => {
              setIsDraggingMap(true);
              handleMapMove(event);
            }}
            className="relative w-full h-32 rounded-xl overflow-hidden cursor-crosshair ring-1 ring-black/5"
            style={{
              backgroundColor: `hsl(${resolvedHsv.h}, 100%, 50%)`,
              backgroundImage: 'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)'
            }}
          >
            <div
              className="absolute w-4 h-4 border-2 border-white rounded-full shadow-md transform -translate-x-1/2 -translate-y-1/2 pointer-events-none"
              style={{ left: `${resolvedHsv.s}%`, top: `${100 - resolvedHsv.v}%`, backgroundColor: selectedColor }}
            />
          </div>
          <div className="relative h-4">
            <div
              ref={hueRef}
              onMouseDown={(event) => {
                setIsDraggingHue(true);
                handleHueMove(event);
              }}
              className="w-full h-full rounded-full shadow-inner cursor-pointer ring-1 ring-black/5"
              style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
            />
            <div
              className="absolute top-0 w-4 h-4 bg-white border-2 border-gray-200 rounded-full shadow-md transform -translate-x-1/2 pointer-events-none"
              style={{ left: `${(resolvedHsv.h / 360) * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default ColorPicker;
