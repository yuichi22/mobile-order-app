import React from 'react';
import { ShoppingCart, Utensils } from 'lucide-react';

import { getAllergenLabel } from '../../../shared/constants/menuMetadata';

const getPhotoLabelClassName = (labelSize = 'md') => {
  const sizeMap = {
    sm: 'max-w-[74%] rounded-br-xl pl-[15px] pr-2.5 py-1 text-[9px]',
    md: 'max-w-[72%] rounded-br-2xl pl-[22px] pr-3.5 py-1.5 text-[10px]',
    wide: 'max-w-[74%] rounded-br-[1.05rem] pl-[22px] pr-4 py-2 text-[11px]',
    lg: 'max-w-[76%] rounded-br-[1.1rem] pl-[22px] pr-4 py-2 text-[11px]'
  };

  return sizeMap[labelSize] || sizeMap.md;
};

const MenuImage = ({
  src,
  alt,
  isSoldOut,
  labelText,
  labelColor,
  labelSize = 'md',
  className
}) => (
  <div className={`relative overflow-hidden bg-gray-50 ${className}`}>
    {src ? (
      <img
        src={src}
        alt={alt}
        className="h-full w-full object-cover transition-transform duration-700 hover:scale-105"
      />
    ) : (
      <div className="flex h-full w-full items-center justify-center text-gray-200">
        <Utensils
          size={className.includes('h-56') || className.includes('h-[340px]') ? 40 : 24}
          strokeWidth={1.5}
        />
      </div>
    )}

    {labelText && (
      <div
        className={`absolute left-0 top-0 z-20 font-black tracking-[0.08em] text-white shadow-md ${getPhotoLabelClassName(labelSize)}`}
        style={{ backgroundColor: labelColor || '#F97316' }}
      >
        <span className="block truncate">
          {labelText}
        </span>
      </div>
    )}

    {isSoldOut && (
      <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/45 backdrop-blur-[1px]">
        <span className="rounded-full bg-white/95 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-gray-900 shadow-sm">
          SOLD OUT
        </span>
      </div>
    )}
  </div>
);

const AllergenChips = ({ allergens = [] }) => {
  if (!allergens.length) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {allergens.slice(0, 3).map((allergenId) => (
        <span
          key={allergenId}
          className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-bold text-amber-700"
        >
          {getAllergenLabel(allergenId)}
        </span>
      ))}
    </div>
  );
};

const OrderButton = ({ onClick, disabled, size = 'md' }) => {
  const sizeClasses = {
    sm: 'h-8 px-3 text-[11px] gap-1.5',
    md: 'h-9 px-4 text-xs gap-1.5',
    lg: 'h-10 px-5 text-sm gap-2'
  };

  const iconSizeMap = {
    sm: 13,
    md: 14,
    lg: 16
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${sizeClasses[size]} flex shrink-0 items-center justify-center rounded-full font-black leading-none shadow-lg ring-1 ring-black/10 transition-all active:scale-90 ${
        disabled
          ? 'bg-white/70 text-gray-300 shadow-none'
          : 'bg-white/95 text-gray-900 backdrop-blur hover:bg-white'
      }`}
      aria-label="カートに追加"
    >
      <ShoppingCart size={iconSizeMap[size] || 14} strokeWidth={3} />
      <span>入れる</span>
    </button>
  );
};

const MetaChips = ({ item }) => {
  const chips = [];

  if (item.allowsTakeout === false) {
    chips.push({
      key: 'eat-in',
      label: '店内のみ',
      className: 'bg-slate-100 text-slate-500'
    });
  }

  if (Number(item.orderLimitPerOrder) > 0) {
    chips.push({
      key: 'limit',
      label: `1回 ${Number(item.orderLimitPerOrder)} 点まで`,
      className: 'bg-slate-100 text-slate-500'
    });
  }

  const hasRemainingQuantity =
    item.remainingQuantity !== null
    && item.remainingQuantity !== undefined
    && item.remainingQuantity !== ''
    && Number.isFinite(Number(item.remainingQuantity));

  if (!item.isSoldOut && hasRemainingQuantity) {
    badges.push({
      label: Number(item.remainingQuantity) > 0
        ? `残り ${Number(item.remainingQuantity)} 点`
        : '売り切れ',
      className: Number(item.remainingQuantity) > 0
        ? 'bg-amber-50 text-amber-700'
        : 'bg-red-50 text-red-600'
    });
  }

  if (!chips.length) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {chips.slice(0, 2).map((chip) => (
        <span
          key={chip.key}
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold ${chip.className}`}
        >
          {chip.label}
        </span>
      ))}
    </div>
  );
};

const PriceDisplay = ({ item, className = '', labelSize = 'md', priceMode = 'normal', priceModeResolver = null }) => {
  const labelClassName = labelSize === 'sm'
    ? 'text-[9px]'
    : 'text-[10px]';

  const resolvedPriceMode = typeof priceModeResolver === 'function' ? priceModeResolver(item) : priceMode;
  const { price, label } = resolveDisplayPrice(item, resolvedPriceMode);

  return (
    <span className={`inline-flex items-baseline gap-1.5 font-black tracking-tight text-gray-900 ${className}`}>
      {label && (
        <span className={`${labelClassName} relative -top-[1px] font-black tracking-normal text-gray-500`}>
          {label}
        </span>
      )}
      <span>
        ¥{Number(price || 0).toLocaleString()}
      </span>
    </span>
  );
};

const resolveDisplayPrice = (item, priceMode = 'normal') => {
  if (priceMode === 'crossSell' && Number(item.crossSellPrice) > 0) {
    return {
      price: Number(item.crossSellPrice),
      label: item.crossSellPriceLabelText || 'セット価格'
    };
  }

  return {
    price: Number(item.price || 0),
    label: item.priceLabelText || ''
  };
};

const WideCard = ({ item, onAdd, orderingDisabled, priceMode, priceModeResolver }) => (
  <div
    className={`flex flex-col overflow-hidden rounded-[2rem] bg-white shadow-[0_8px_28px_rgba(15,23,42,0.06)] animate-in fade-in duration-500 ${
      item.isSoldOut ? 'opacity-70 grayscale' : ''
    }`}
  >
    <div className="relative">
<MenuImage
  src={item.image}
  alt={item.name || 'メニュー画像'}
  isSoldOut={item.isSoldOut}
  labelText={item.photoLabelText}
  labelColor={item.photoLabelColor}
  labelSize="wide"
  className="h-56 w-full"
/>

      <div className="absolute bottom-4 right-4 z-20">
        <OrderButton
          onClick={() => onAdd(item)}
          size="md"
          disabled={item.isSoldOut || orderingDisabled}
        />
      </div>
    </div>

    <div className="px-5 pb-5 pt-4">
      <div className="flex items-start justify-between gap-4">
        <h3 className="min-w-0 flex-1 line-clamp-2 text-lg font-black leading-tight tracking-tight text-gray-900">
          {item.name || 'メニュー名'}
        </h3>

<PriceDisplay
  item={item}
  priceMode={priceMode}
  priceModeResolver={priceModeResolver}
  className="shrink-0 text-lg leading-tight"
/>
      </div>

      {item.description && (
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-gray-400">
          {item.description}
        </p>
      )}

      <MetaChips item={item} />
      <AllergenChips allergens={item.allergens || []} />
    </div>
  </div>
);

const ListCard = ({ item, onAdd, orderingDisabled, priceMode, priceModeResolver }) => (
  <div
    className={`flex items-center gap-4 rounded-[1.75rem] bg-white p-3 shadow-[0_4px_18px_rgba(15,23,42,0.05)] animate-in fade-in duration-300 ${
      item.isSoldOut ? 'opacity-60' : ''
    }`}
  >
<MenuImage
  src={item.image}
  alt={item.name || 'メニュー画像'}
  isSoldOut={item.isSoldOut}
  labelText={item.photoLabelText}
  labelColor={item.photoLabelColor}
  labelSize="sm"
  className="h-[104px] w-[104px] shrink-0 rounded-[1.35rem]"
/>

    <div className="min-w-0 flex-grow">
      <h3 className="line-clamp-2 text-[15px] font-black leading-tight tracking-tight text-gray-900">
        {item.name || 'メニュー名'}
      </h3>

      {item.description && (
        <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-gray-400">
          {item.description}
        </p>
      )}

      <MetaChips item={item} />

      <div className="mt-3 flex items-center justify-between gap-3">
<PriceDisplay
  item={item}
  priceMode={priceMode}
  priceModeResolver={priceModeResolver}
  className="text-lg"
/>

        <OrderButton
          onClick={() => onAdd(item)}
          size="md"
          disabled={item.isSoldOut || orderingDisabled}
        />
      </div>
    </div>
  </div>
);

const GridCard = ({ item, onAdd, orderingDisabled, priceMode, priceModeResolver }) => (
  <div
    className={`flex h-full flex-col overflow-hidden rounded-[1.6rem] bg-white shadow-[0_4px_16px_rgba(15,23,42,0.05)] animate-in fade-in duration-300 ${
      item.isSoldOut ? 'opacity-60' : ''
    }`}
  >
    <div className="relative">
      <MenuImage
        src={item.image}
        alt={item.name || 'メニュー画像'}
        isSoldOut={item.isSoldOut}
        labelText={item.photoLabelText}
        labelColor={item.photoLabelColor}
        labelSize="sm"
        className="aspect-square w-full"
      />

      <div className="absolute bottom-3 right-3 z-20">
        <OrderButton
          onClick={() => onAdd(item)}
          size="sm"
          disabled={item.isSoldOut || orderingDisabled}
        />
      </div>
    </div>

    <div className="flex flex-grow flex-col px-3.5 pb-4 pt-3.5">
      <h3 className="line-clamp-2 text-[14px] font-black leading-snug tracking-tight text-gray-900">
        {item.name || 'メニュー名'}
      </h3>

      {item.description && (
        <p className="mt-1.5 line-clamp-1 text-[10px] leading-relaxed text-gray-400">
          {item.description}
        </p>
      )}

      <MetaChips item={item} />
      <AllergenChips allergens={item.allergens || []} />

      <div className="mt-auto flex justify-end pt-2">
<PriceDisplay
  item={item}
  priceMode={priceMode}
  priceModeResolver={priceModeResolver}
  labelSize="sm"
  className="text-[16px] leading-tight"
/>
      </div>
    </div>
  </div>
);

const LimitedCard = ({ item, onAdd, orderingDisabled, priceMode, priceModeResolver }) => (
  <div
    className={`overflow-hidden rounded-[2rem] bg-white shadow-[0_10px_34px_rgba(15,23,42,0.08)] animate-in fade-in duration-500 ${
      item.isSoldOut ? 'opacity-70 grayscale' : ''
    }`}
  >
    <div className="relative">
      <MenuImage
        src={item.image}
        alt={item.name || 'メニュー画像'}
        isSoldOut={item.isSoldOut}
        labelText={item.photoLabelText}
        labelColor={item.photoLabelColor}
        labelSize="lg"
        className="h-[340px] w-full"
      />

      <div className="absolute bottom-4 right-4 z-20">
        <OrderButton
          onClick={() => onAdd(item)}
          size="lg"
          disabled={item.isSoldOut || orderingDisabled}
        />
      </div>
    </div>

    <div className="px-5 pb-5 pt-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-xl font-black leading-tight tracking-tight text-gray-900">
            {item.name || 'メニュー名'}
          </h3>

          {item.description && (
            <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-gray-500">
              {item.description}
            </p>
          )}
        </div>

<PriceDisplay
  item={item}
  priceMode={priceMode}
  priceModeResolver={priceModeResolver}
  className="shrink-0 text-xl leading-tight"
/>
      </div>

      <MetaChips item={item} />
      <AllergenChips allergens={item.allergens || []} />
    </div>
  </div>
);

const MenuLayoutRenderer = ({
  layoutMode = 'grid',
  items = [],
  onAdd,
  orderingDisabled = false,
  priceMode = 'normal',
  priceModeResolver = null
}) => {
  if (!items || items.length === 0) {
    return <div className="py-10 text-center text-gray-400">メニューがありません。</div>;
  }

  const configs = {
    wide: { container: 'flex flex-col gap-8', Component: WideCard },
    list: { container: 'flex flex-col gap-3.5', Component: ListCard },
    grid: { container: 'grid grid-cols-2 gap-3.5', Component: GridCard },
    limited: { container: 'flex flex-col gap-5', Component: LimitedCard }
  };

  const { container, Component } = configs[layoutMode] || configs.grid;

  return (
    <div className={`animate-in slide-in-from-bottom-4 p-4 pb-32 fade-in duration-700 ${container}`}>
      {items.map((item) => (
<Component
  key={item.id}
  item={item}
  onAdd={onAdd}
  orderingDisabled={orderingDisabled}
  priceMode={priceMode}
  priceModeResolver={priceModeResolver}
/>
      ))}
    </div>
  );
};

export default MenuLayoutRenderer;