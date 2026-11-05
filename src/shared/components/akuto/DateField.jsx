/*
 * AKUTO 共通：日付・時刻・月の選び方（BRANDBOOK「日付・時刻の選び方」）。
 * 原本は akuto-staff-app の src/components/DateField.tsx（ここはその写し。見た目を変えずに使う）。
 * 基は mobile_order 分析画面のカレンダー。ブラウザ標準の type="date" / "time" / "month" の代わりに使う。
 *
 *   <DateField value="2026-11-05" onChange={setDate} label="日付" />      値は YYYY-MM-DD
 *   <TimeField value="09:30" onChange={setTime} step={5} label="開始" />  値は HH:MM（step=1 で1分単位）
 *   <MonthField value="2026-11" onChange={setMonth} label="締め月" />      値は YYYY-MM
 *   inline   … モーダルやスマホのフォームでは、重ねずに欄の下に押し広げて開く
 *   width    … 横に並べるときの幅（既定 100%）
 *   自前のボタンから開くときは DatePanel / MonthPanel / TimePanel を
 *   position: relative の箱の中に置き、closeOnOutside を付ける。
 */
import { useEffect, useRef, useState } from "react";
import { Calendar as CalendarIcon, ChevronDown, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import "./akuto-date-field.css";
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const pad = (n) => String(n).padStart(2, "0");
const toYmd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const fmtDate = (s) => {
  const d = parseYmd(s);
  return d ? `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）` : "";
};
const fmtMonth = (s) => {
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  return m ? `${m[1]}年${Number(m[2])}月` : "";
};
function useOutside(open, close) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) close();
    };
    const onKey = (e) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}
function FieldButton({
  open,
  onClick,
  text,
  placeholder,
  icon,
  label,
  disabled
}) {
  const Icon = icon;
  return <button
    type="button"
    className="ak-picker-field"
    data-open={open}
    aria-haspopup="dialog"
    aria-expanded={open}
    disabled={disabled}
    aria-label={label ? `${label}：${text || placeholder}` : void 0}
    onClick={onClick}
  >
      <span className={text ? "ak-num" : "ak-picker-placeholder"}>{text || placeholder}</span>
      <Icon size={18} strokeWidth={1.5} aria-hidden="true" />
    </button>;
}
function Panel({
  inline,
  children,
  label,
  onClose,
  closeOnOutside
}) {
  const ref = useOutside(!!closeOnOutside, onClose);
  return <div ref={ref} className={`ak-picker${inline ? " ak-picker-inline" : ""}`} role="dialog" aria-label={label}>
      {children}
    </div>;
}
function DatePanel({
  value,
  onPick,
  onClose,
  label,
  inline,
  closeOnOutside,
  min,
  max,
  startView = "days"
}) {
  const selected = parseYmd(value);
  const [view, setView] = useState(
    selected ?? (startView === "years" ? new Date((/* @__PURE__ */ new Date()).getFullYear() - 20, 0, 1) : /* @__PURE__ */ new Date())
  );
  const [mode, setMode] = useState(!selected && startView === "years" ? "years" : "days");
  const yearsRef = useRef(null);
  useEffect(() => {
    if (mode !== "years") return;
    yearsRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: "center" });
  }, [mode]);
  const y = view.getFullYear();
  const m = view.getMonth();
  const today = toYmd(/* @__PURE__ */ new Date());
  const outOfRange = (d) => {
    const k = toYmd(d);
    return (!!min && k < min) || (!!max && k > max);
  };
  const cells = [];
  const first = new Date(y, m, 1).getDay();
  for (let i = first; i > 0; i -= 1) cells.push({ date: new Date(y, m, 1 - i), other: true });
  const days = new Date(y, m + 1, 0).getDate();
  for (let d = 1; d <= days; d += 1) cells.push({ date: new Date(y, m, d), other: false });
  while (cells.length % 7 !== 0) cells.push({ date: new Date(y, m + 1, cells.length - first - days + 1), other: true });
  const pick = (d) => {
    onPick(toYmd(d));
    onClose();
  };
  const yearFrom = startView === "years" ? (/* @__PURE__ */ new Date()).getFullYear() - 80 : y - 10;
  const yearTo = startView === "years" ? (/* @__PURE__ */ new Date()).getFullYear() : y + 9;
  return <Panel inline={inline} label={label ?? "日付を選ぶ"} onClose={onClose} closeOnOutside={closeOnOutside}>
      <div className="ak-picker-head">
        <button
    type="button"
    className="ak-picker-nav"
    aria-label={mode === "months" ? "前の年" : "前の月"}
    style={{ visibility: mode === "years" ? "hidden" : void 0 }}
    onClick={() => setView(mode === "months" ? new Date(y - 1, m, 1) : new Date(y, m - 1, 1))}
  >
          <ChevronLeft size={18} strokeWidth={1.5} />
        </button>
        <div className="ak-picker-title">
          <button
    type="button"
    className="ak-picker-ym"
    aria-pressed={mode === "years"}
    onClick={() => setMode(mode === "years" ? "days" : "years")}
  >
            <span className="ak-num">{y}</span>年 <ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" />
          </button>
          <button
    type="button"
    className="ak-picker-ym"
    aria-pressed={mode === "months"}
    onClick={() => setMode(mode === "months" ? "days" : "months")}
  >
            <span className="ak-num">{m + 1}</span>月 <ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
        <button
    type="button"
    className="ak-picker-nav"
    aria-label={mode === "months" ? "次の年" : "次の月"}
    style={{ visibility: mode === "years" ? "hidden" : void 0 }}
    onClick={() => setView(mode === "months" ? new Date(y + 1, m, 1) : new Date(y, m + 1, 1))}
  >
          <ChevronRight size={18} strokeWidth={1.5} />
        </button>
      </div>

      {mode === "days" && <>
          <div className="ak-picker-week">
            {WEEKDAYS.map((w, i) => <span key={w} data-dow={i}>
                {w}
              </span>)}
          </div>
          <div className="ak-picker-grid">
            {cells.map(({ date, other }) => {
    const ymd = toYmd(date);
    return <button
      key={ymd}
      type="button"
      className="ak-picker-day"
      data-other={other}
      data-dow={date.getDay()}
      data-today={ymd === today}
      aria-pressed={ymd === value}
      aria-label={fmtDate(ymd)}
      disabled={outOfRange(date)}
      onClick={() => pick(date)}
    >
                  {date.getDate()}
                </button>;
  })}
          </div>
          <div className="ak-picker-foot">
            <button
    type="button"
    className="ak-picker-btn ak-picker-btn-quiet"
    disabled={outOfRange(/* @__PURE__ */ new Date())}
    onClick={() => pick(/* @__PURE__ */ new Date())}
  >
              今日
            </button>
          </div>
        </>}

      {mode === "months" && <div className="ak-picker-cells3">
          {Array.from({ length: 12 }, (_, i) => <button
    key={i}
    type="button"
    className="ak-picker-cell"
    aria-pressed={i === m}
    onClick={() => {
      setView(new Date(y, i, 1));
      setMode("days");
    }}
  >
              <span className="ak-num">{i + 1}</span>月
            </button>)}
        </div>}

      {mode === "years" && <div className="ak-picker-cells3 ak-picker-years" ref={yearsRef}>
          {Array.from({ length: yearTo - yearFrom + 1 }, (_, i) => yearFrom + i).map((yy) => <button
    key={yy}
    type="button"
    className="ak-picker-cell"
    aria-pressed={yy === y}
    onClick={() => {
      setView(new Date(yy, m, 1));
      setMode(startView === "years" && !selected ? "months" : "days");
    }}
  >
              {yy}
            </button>)}
        </div>}
    </Panel>;
}
function DateField({
  value,
  onChange,
  label,
  placeholder = "日付を選ぶ",
  inline,
  width,
  min,
  max,
  startView = "days",
  disabled
}) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  return <div className="ak-picker-wrap" ref={ref} style={{ width }}>
      <FieldButton
    open={open}
    onClick={() => setOpen(!open)}
    text={fmtDate(value)}
    placeholder={placeholder}
    icon={CalendarIcon}
    label={label}
    disabled={disabled}
  />
      {open && <DatePanel
    value={value}
    onPick={onChange}
    onClose={() => setOpen(false)}
    label={label}
    inline={inline}
    min={min}
    max={max}
    startView={startView}
  />}
    </div>;
}
function MonthPanel({
  value,
  onPick,
  onClose,
  label,
  inline,
  closeOnOutside
}) {
  const cur = /^(\d{4})-(\d{2})$/.exec(value);
  const [year, setYear] = useState(cur ? Number(cur[1]) : (/* @__PURE__ */ new Date()).getFullYear());
  return <Panel inline={inline} label={label ?? "月を選ぶ"} onClose={onClose} closeOnOutside={closeOnOutside}>
      <div className="ak-picker-head">
        <button type="button" className="ak-picker-nav" aria-label="前の年" onClick={() => setYear(year - 1)}>
          <ChevronLeft size={18} strokeWidth={1.5} />
        </button>
        <div className="ak-picker-title">
          <span className="ak-picker-ym" style={{ cursor: "default" }}>
            <span className="ak-num">{year}</span>年
          </span>
        </div>
        <button type="button" className="ak-picker-nav" aria-label="次の年" onClick={() => setYear(year + 1)}>
          <ChevronRight size={18} strokeWidth={1.5} />
        </button>
      </div>
      <div className="ak-picker-cells3">
        {Array.from({ length: 12 }, (_, i) => {
    const v = `${year}-${pad(i + 1)}`;
    return <button
      key={v}
      type="button"
      className="ak-picker-cell"
      aria-pressed={v === value}
      onClick={() => {
        onPick(v);
        onClose();
      }}
    >
              <span className="ak-num">{i + 1}</span>月
            </button>;
  })}
      </div>
    </Panel>;
}
function MonthField({
  value,
  onChange,
  label,
  placeholder = "月を選ぶ",
  inline,
  width,
  disabled
}) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  return <div className="ak-picker-wrap" ref={ref} style={{ width }}>
      <FieldButton
    open={open}
    onClick={() => setOpen(!open)}
    text={fmtMonth(value)}
    placeholder={placeholder}
    icon={CalendarIcon}
    label={label}
    disabled={disabled}
  />
      {open && <MonthPanel value={value} onPick={onChange} onClose={() => setOpen(false)} label={label} inline={inline} />}
    </div>;
}
function TimePanel({
  value,
  onPick,
  onClose,
  label,
  inline,
  closeOnOutside,
  step = 5
}) {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  const h = m ? Number(m[1]) : null;
  const mi = m ? Number(m[2]) : null;
  const set = (hh, mm, close = false) => {
    onPick(`${pad(hh ?? 9)}:${pad(mm ?? 0)}`);
    if (close) onClose();
  };
  return <Panel inline={inline} label={label ?? "時刻を選ぶ"} onClose={onClose} closeOnOutside={closeOnOutside}>
      <p className="ak-picker-sub">時</p>
      <div className="ak-picker-cells6">
        {Array.from({ length: 24 }, (_, i) => <button
    key={i}
    type="button"
    className="ak-picker-cell"
    aria-pressed={i === h}
    onClick={() => set(i, mi)}
  >
            {i}
          </button>)}
      </div>
      {step === 1 ? <>
          <p className="ak-picker-sub">分（10の位）</p>
          <div className="ak-picker-cells6">
            {Array.from({ length: 6 }, (_, i) => <button
    key={i}
    type="button"
    className="ak-picker-cell"
    aria-pressed={mi !== null && Math.floor(mi / 10) === i}
    onClick={() => set(h, i * 10 + (mi ?? 0) % 10)}
  >
                {i}0
              </button>)}
          </div>
          <p className="ak-picker-sub">分（1の位）</p>
          <div className="ak-picker-cells5">
            {Array.from({ length: 10 }, (_, i) => <button
    key={i}
    type="button"
    className="ak-picker-cell"
    aria-pressed={mi !== null && mi % 10 === i}
    onClick={() => set(h, Math.floor((mi ?? 0) / 10) * 10 + i, h !== null)}
  >
                {i}
              </button>)}
          </div>
        </> : <>
          <p className="ak-picker-sub">分</p>
          <div className="ak-picker-cells6">
            {Array.from({ length: 60 / step }, (_, i) => i * step).map((mm) => <button
    key={mm}
    type="button"
    className="ak-picker-cell"
    aria-pressed={mm === mi}
    onClick={() => set(h, mm, h !== null)}
  >
                {pad(mm)}
              </button>)}
          </div>
        </>}
      <div className="ak-picker-foot">
        <span className="ak-picker-now">{m ? `${h}:${pad(mi ?? 0)}` : "―"}</span>
        <button type="button" className="ak-picker-btn ak-picker-btn-sub" onClick={onClose}>
          決める
        </button>
      </div>
    </Panel>;
}
function TimeField({
  value,
  onChange,
  label,
  placeholder = "時刻を選ぶ",
  inline,
  width,
  step = 5,
  disabled
}) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  return <div className="ak-picker-wrap" ref={ref} style={{ width }}>
      <FieldButton
    open={open}
    onClick={() => setOpen(!open)}
    text={m ? `${Number(m[1])}:${m[2]}` : ""}
    placeholder={placeholder}
    icon={Clock}
    label={label}
    disabled={disabled}
  />
      {open && <TimePanel
    value={value}
    onPick={onChange}
    onClose={() => setOpen(false)}
    label={label}
    inline={inline}
    step={step}
  />}
    </div>;
}
export {
  DateField,
  DatePanel,
  MonthField,
  MonthPanel,
  TimeField,
  TimePanel
};
