import { useMemo } from 'react';
import { encodeCode128 } from '../utils/code128';

// 規格上の両端余白(10モジュール以上)。スマホ画面の枠に詰めて描くとリーダーが端を見失うため多めに取る。
const QUIET_ZONE_MODULES = 12;

// Code128 を SVG で描く。横幅いっぱいに伸ばしてもバー幅の比率は崩れない(横方向は一様拡大)。
// 背景は白で塗る(スマホの暗い背景やダークモードでも読めるように)。
const Code128Barcode = ({ value, height = 88, className = '', showText = true }) => {
  const widths = useMemo(() => encodeCode128(value), [value]);
  if (!widths) return null;

  const totalModules = widths.reduce((sum, width) => sum + width, 0) + QUIET_ZONE_MODULES * 2;
  const bars = [];
  let x = QUIET_ZONE_MODULES;
  widths.forEach((width, index) => {
    if (index % 2 === 0) bars.push(<rect key={index} x={x} y={0} width={width} height={height} />);
    x += width;
  });

  return (
    <div className={`bg-white ${className}`}>
      <svg
        viewBox={`0 0 ${totalModules} ${height}`}
        preserveAspectRatio="none"
        width="100%"
        height={height}
        shapeRendering="crispEdges"
        role="img"
        aria-label={value}
      >
        <rect x={0} y={0} width={totalModules} height={height} fill="#fff" />
        <g fill="#000">{bars}</g>
      </svg>
      {showText && (
        <p className="mt-1 text-center font-mono text-xs tracking-wider text-gray-700">{value}</p>
      )}
    </div>
  );
};

export default Code128Barcode;
