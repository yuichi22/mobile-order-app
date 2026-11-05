import React, { useState, useEffect, useRef } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, ChevronDown, ArrowRight } from 'lucide-react';

import { toDate, formatDateDisplay } from '../utils/analyticsHelpers';
import '../../../../shared/components/akuto/akuto-date-field.css';

const isSameDay = (d1, d2) => {
  const date1 = toDate(d1);
  const date2 = toDate(d2);
  if (!date1 || !date2) return false;
  return date1.getFullYear() === date2.getFullYear()
    && date1.getMonth() === date2.getMonth()
    && date1.getDate() === date2.getDate();
};

const getWeekNumber = (date) => {
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const firstDay = new Date(target.getFullYear(), 0, 1);
  const dayOfYear = ((target - firstDay) / 86400000) + 1;
  return Math.ceil((dayOfYear + firstDay.getDay()) / 7);
};

const getWeeksInMonth = (year, month) => {
  const weeks = [];
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  let current = new Date(firstDay);
  current.setDate(current.getDate() - current.getDay());

  while (current <= lastDay || (current > lastDay && current.getDay() !== 0)) {
    const start = new Date(current);
    const end = new Date(current);
    end.setDate(end.getDate() + 6);

    if (start.getMonth() === month || end.getMonth() === month) {
      const weekNum = getWeekNumber(start);
      weeks.push({
        weekNum,
        start,
        end,
        label: `第${weekNum}週`
      });
    }

    current.setDate(current.getDate() + 7);
    if (weeks.length > 6) break;
  }

  return weeks;
};

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

const CustomRangePicker = ({ startDate, endDate, onChange, isWeekMode }) => {
  const [activeInput, setActiveInput] = useState(null);
  const [viewDate, setViewDate] = useState(new Date());
  const [calendarView, setCalendarView] = useState(isWeekMode ? 'weeks' : 'days');
  const containerRef = useRef(null);
  const yearListRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setActiveInput(null);
        setCalendarView(isWeekMode ? 'weeks' : 'days');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isWeekMode]);

  useEffect(() => {
    if (calendarView !== 'years') return;
    setTimeout(() => {
      if (!yearListRef.current) return;
      const selectedYearButton = yearListRef.current.querySelector('[data-selected-year="true"]');
      if (selectedYearButton) selectedYearButton.scrollIntoView({ block: 'center', behavior: 'auto' });
    }, 10);
  }, [calendarView]);

  const safeViewDate = toDate(viewDate) || new Date();

  const openCalendar = (target) => {
    const start = toDate(startDate);
    const end = toDate(endDate);

    if (target === 'start' && start) setViewDate(start);
    else if (target === 'end' && end) setViewDate(end);
    else if (target === 'end' && start) setViewDate(start);

    setCalendarView(isWeekMode ? 'weeks' : 'days');
    setActiveInput(target);
  };

  const handlePrev = (event) => {
    event.stopPropagation();
    const year = safeViewDate.getFullYear();
    const month = safeViewDate.getMonth();

    if (calendarView === 'days' || calendarView === 'weeks') setViewDate(new Date(year, month - 1, 1));
    else if (calendarView === 'months') setViewDate(new Date(year - 1, month, 1));
  };

  const handleNext = (event) => {
    event.stopPropagation();
    const year = safeViewDate.getFullYear();
    const month = safeViewDate.getMonth();

    if (calendarView === 'days' || calendarView === 'weeks') setViewDate(new Date(year, month + 1, 1));
    else if (calendarView === 'months') setViewDate(new Date(year + 1, month, 1));
  };

  const handleDateClick = (date) => {
    if (isWeekMode) return;

    if (activeInput === 'start') {
      let nextEnd = toDate(endDate);
      if (nextEnd && date > nextEnd) nextEnd = null;
      onChange(date, nextEnd);
      setActiveInput('end');
    } else {
      let nextStart = toDate(startDate);
      if (nextStart && date < nextStart) {
        nextStart = date;
        onChange(nextStart, null);
      } else {
        onChange(nextStart, date);
        setActiveInput(null);
      }
    }
  };

  const handleWeekClick = (week) => {
    if (activeInput === 'start') {
      onChange(week.start, null);
      setActiveInput('end');
    } else {
      const currentStart = toDate(startDate);
      if (currentStart && week.end < currentStart) {
        onChange(week.start, null);
      } else {
        onChange(currentStart, week.end);
        setActiveInput(null);
      }
    }
  };

  // 見た目は AKUTO 共通の日付パネル（shared/components/akuto）と同じ部品クラスを使う
  const renderDays = () => {
    const year = safeViewDate.getFullYear();
    const month = safeViewDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay = new Date(year, month, 1).getDay();
    const start = toDate(startDate);
    const end = toDate(endDate);
    const cells = [];
    for (let index = firstDay; index > 0; index -= 1) cells.push({ date: new Date(year, month, 1 - index), other: true });
    for (let day = 1; day <= daysInMonth; day += 1) cells.push({ date: new Date(year, month, day), other: false });
    while (cells.length % 7 !== 0) cells.push({ date: new Date(year, month + 1, cells.length - firstDay - daysInMonth + 1), other: true });

    return (
      <>
        <div className="ak-picker-week">
          {WEEKDAYS.map((day, index) => (
            <span key={day} data-dow={index}>{day}</span>
          ))}
        </div>
        <div className="ak-picker-grid">
          {cells.map(({ date, other }) => {
            const isEdge = isSameDay(date, startDate) || isSameDay(date, endDate);
            const inRange = Boolean(start && end && date > start && date < end);
            return (
              <button
                key={date.toDateString()}
                type="button"
                className="ak-picker-day"
                data-other={other}
                data-dow={date.getDay()}
                data-today={isSameDay(date, new Date())}
                data-inrange={inRange}
                aria-pressed={isEdge}
                onClick={(event) => { event.stopPropagation(); handleDateClick(date); }}
              >
                {date.getDate()}
              </button>
            );
          })}
        </div>
      </>
    );
  };

  const renderWeeks = () => {
    const weeks = getWeeksInMonth(safeViewDate.getFullYear(), safeViewDate.getMonth());
    const start = toDate(startDate);
    const end = toDate(endDate);

    return (
      <div className="flex flex-col gap-2">
        {weeks.map((week) => {
          const isStartWeek = start && isSameDay(week.start, start);
          const isEndWeek = end && isSameDay(week.end, end);
          const inRange = start && end ? week.start > start && week.end < end : false;
          const isSelected = isStartWeek || isEndWeek;

          let bgClass = 'bg-white border-gray-200 hover:border-gray-300 text-gray-900';
          if (isSelected) {
            bgClass = 'bg-gray-900 text-white border-gray-900';
          } else if (inRange) {
            bgClass = 'bg-gray-100 border-gray-100 text-gray-900';
          }

          return (
            <button
              key={week.weekNum}
              type="button"
              onClick={(event) => { event.stopPropagation(); handleWeekClick(week); }}
              className={`group flex min-h-[44px] w-full items-center justify-between rounded-xl border-2 px-4 py-2 text-left transition-all ${bgClass}`}
            >
              <div>
                <span className={`block text-sm font-black ${isSelected ? 'text-white' : 'text-gray-900'}`}>
                  {week.label}
                </span>
                <span className={`text-xs font-bold tabular-nums ${isSelected ? 'text-gray-200' : 'text-gray-500'}`}>
                  {week.start.getMonth() + 1}/{week.start.getDate()} - {week.end.getMonth() + 1}/{week.end.getDate()}
                </span>
              </div>
              <ChevronRight size={16} strokeWidth={1.5} className={isSelected ? 'text-white' : 'text-gray-500'} />
            </button>
          );
        })}
      </div>
    );
  };

  const renderCalendarContent = () => (
    <div className="ak-picker" style={{ position: 'static' }} role="dialog" aria-label="期間を選ぶ">
      <div className="ak-picker-head">
        <button
          type="button"
          onClick={handlePrev}
          className="ak-picker-nav"
          aria-label="前へ"
          style={{ visibility: calendarView === 'years' ? 'hidden' : undefined }}
        >
          <ChevronLeft size={18} strokeWidth={1.5} />
        </button>
        <div className="ak-picker-title">
          <button
            type="button"
            className="ak-picker-ym"
            aria-pressed={calendarView === 'years'}
            onClick={(event) => { event.stopPropagation(); setCalendarView('years'); }}
          >
            {safeViewDate.getFullYear()}年 <ChevronDown size={14} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            className="ak-picker-ym"
            aria-pressed={calendarView === 'months'}
            onClick={(event) => { event.stopPropagation(); setCalendarView('months'); }}
          >
            {safeViewDate.getMonth() + 1}月 <ChevronDown size={14} strokeWidth={1.5} />
          </button>
        </div>
        <button
          type="button"
          onClick={handleNext}
          className="ak-picker-nav"
          aria-label="次へ"
          style={{ visibility: calendarView === 'years' ? 'hidden' : undefined }}
        >
          <ChevronRight size={18} strokeWidth={1.5} />
        </button>
      </div>
      {calendarView === 'days' && renderDays()}
      {calendarView === 'weeks' && renderWeeks()}
      {calendarView === 'months' && (
        <div className="ak-picker-cells3">
          {Array.from({ length: 12 }, (_, index) => index).map((month) => (
            <button
              key={month}
              type="button"
              className="ak-picker-cell"
              aria-pressed={safeViewDate.getMonth() === month}
              onClick={(event) => {
                event.stopPropagation();
                setViewDate(new Date(safeViewDate.getFullYear(), month, 1));
                setCalendarView(isWeekMode ? 'weeks' : 'days');
              }}
            >
              {month + 1}月
            </button>
          ))}
        </div>
      )}
      {calendarView === 'years' && (
        <div ref={yearListRef} className="ak-picker-cells3 ak-picker-years">
          {Array.from({ length: 20 }, (_, index) => safeViewDate.getFullYear() - 10 + index).map((year) => (
            <button
              key={year}
              type="button"
              className="ak-picker-cell"
              data-selected-year={safeViewDate.getFullYear() === year}
              aria-pressed={safeViewDate.getFullYear() === year}
              onClick={(event) => {
                event.stopPropagation();
                setViewDate(new Date(year, safeViewDate.getMonth(), 1));
                setCalendarView('months');
              }}
            >
              {year}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const field = (target, value, placeholder) => (
    <button
      type="button"
      onClick={() => (activeInput === target ? setActiveInput(null) : openCalendar(target))}
      className="ak-picker-field ak-picker-field-btn"
      data-open={activeInput === target}
      style={{ width: 200 }}
      aria-expanded={activeInput === target}
    >
      <span className={value ? '' : 'ak-picker-placeholder'}>{formatDateDisplay(value) || placeholder}</span>
      <CalendarIcon size={18} strokeWidth={1.5} />
    </button>
  );

  return (
    <div className="relative flex flex-wrap items-center gap-2" ref={containerRef}>
      <div className="relative">
        {field('start', startDate, '開始日')}
        {activeInput === 'start' && <div className="absolute left-0 top-full z-50 mt-2">{renderCalendarContent()}</div>}
      </div>
      <ArrowRight size={20} strokeWidth={1.5} className="text-gray-500" />
      <div className="relative">
        {field('end', endDate, '終了日')}
        {activeInput === 'end' && <div className="absolute right-0 top-full z-50 mt-2">{renderCalendarContent()}</div>}
      </div>
    </div>
  );
};

export default CustomRangePicker;
