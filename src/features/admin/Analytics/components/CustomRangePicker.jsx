import React, { useState, useEffect, useRef } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, ChevronDown, ArrowRight } from 'lucide-react';

import { toDate, formatDateDisplay } from '../utils/analyticsHelpers';

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

  const renderDays = () => {
    const year = safeViewDate.getFullYear();
    const month = safeViewDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay = new Date(year, month, 1).getDay();
    const days = [];
    for (let index = 0; index < firstDay; index += 1) days.push(<div key={`empty-${index}`} />);

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(year, month, day);
      const isStart = isSameDay(date, startDate);
      const isEnd = isSameDay(date, endDate);
      const start = toDate(startDate);
      const end = toDate(endDate);
      const inRange = start && end && date > start && date < end;
      const isToday = isSameDay(date, new Date());
      let bgClass = 'hover:bg-blue-50 text-gray-700';
      let textClass = '';
      if (isStart || isEnd) {
        bgClass = 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm';
        textClass = 'font-bold';
      } else if (inRange) {
        bgClass = 'bg-blue-100 text-blue-800';
      } else if (isToday) {
        textClass = 'font-bold text-blue-600';
        bgClass = 'border border-blue-200 hover:bg-blue-50';
      }
      days.push(
        <button
          key={day}
          onClick={(event) => { event.stopPropagation(); handleDateClick(date); }}
          className={`flex h-8 w-full items-center justify-center rounded text-xs transition-all ${bgClass} ${textClass}`}
        >
          {day}
        </button>
      );
    }

    return (
      <>
        <div className="mb-2 grid grid-cols-7 border-b pb-2">
          {WEEKDAYS.map((day, index) => (
            <div key={day} className={`text-center text-[10px] font-bold ${index === 0 ? 'text-red-400' : index === 6 ? 'text-blue-400' : 'text-gray-400'}`}>
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {days}
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

          let bgClass = 'bg-white border-gray-200 hover:bg-blue-50 text-gray-700';
          if (isSelected) {
            bgClass = 'bg-blue-600 text-white border-blue-600 shadow-md';
          } else if (inRange) {
            bgClass = 'bg-blue-50 border-blue-200 text-blue-800';
          }

          return (
            <button
              key={week.weekNum}
              onClick={(event) => { event.stopPropagation(); handleWeekClick(week); }}
              className={`group flex w-full items-center justify-between rounded-lg border p-3 text-left transition-all ${bgClass}`}
            >
              <div>
                <span className={`block text-sm font-bold ${isSelected ? 'text-white' : 'text-gray-800'}`}>
                  {week.label}
                </span>
                <span className={`text-xs ${isSelected ? 'text-blue-100' : 'text-gray-400'}`}>
                  {week.start.getMonth() + 1}/{week.start.getDate()} - {week.end.getMonth() + 1}/{week.end.getDate()}
                </span>
              </div>
              <ChevronRight size={16} className={`${isSelected ? 'text-white' : 'text-gray-300 group-hover:text-blue-400'}`} />
            </button>
          );
        })}
      </div>
    );
  };

  const renderCalendarContent = () => (
    <div className="z-50 w-[280px] rounded-xl border border-gray-200 bg-white p-4 shadow-xl animate-in zoom-in-95 fade-in duration-200">
      <div className="mb-4 flex items-center justify-between">
        <button onClick={handlePrev} className={`rounded-full p-1 text-gray-600 hover:bg-gray-100 ${calendarView === 'years' ? 'invisible' : ''}`}><ChevronLeft size={16} /></button>
        <div className="flex gap-1">
          <button
            onClick={(event) => { event.stopPropagation(); setCalendarView('years'); }}
            className={`flex items-center gap-1 rounded px-2 py-1 text-sm font-bold ${calendarView === 'years' ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100'}`}
          >
            {safeViewDate.getFullYear()}年 <ChevronDown size={12} />
          </button>
          <button
            onClick={(event) => { event.stopPropagation(); setCalendarView('months'); }}
            className={`flex items-center gap-1 rounded px-2 py-1 text-sm font-bold ${calendarView === 'months' ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100'}`}
          >
            {safeViewDate.getMonth() + 1}月 <ChevronDown size={12} />
          </button>
        </div>
        <button onClick={handleNext} className={`rounded-full p-1 text-gray-600 hover:bg-gray-100 ${calendarView === 'years' ? 'invisible' : ''}`}><ChevronRight size={16} /></button>
      </div>
      <div className="min-h-[220px]">
        {calendarView === 'days' && renderDays()}
        {calendarView === 'weeks' && renderWeeks()}
        {calendarView === 'months' && (
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 12 }, (_, index) => index).map((month) => (
              <button key={month} onClick={(event) => {
                event.stopPropagation();
                setViewDate(new Date(safeViewDate.getFullYear(), month, 1));
                setCalendarView(isWeekMode ? 'weeks' : 'days');
              }} className={`rounded py-2 text-sm ${safeViewDate.getMonth() === month ? 'bg-blue-600 text-white' : 'hover:bg-gray-100'}`}>{month + 1}月</button>
            ))}
          </div>
        )}
        {calendarView === 'years' && (
          <div ref={yearListRef} className="grid max-h-[220px] grid-cols-3 gap-2 overflow-y-auto">
            {Array.from({ length: 20 }, (_, index) => safeViewDate.getFullYear() - 10 + index).map((year) => (
              <button key={year} data-selected-year={safeViewDate.getFullYear() === year} onClick={(event) => {
                event.stopPropagation();
                setViewDate(new Date(year, safeViewDate.getMonth(), 1));
                setCalendarView('months');
              }} className={`rounded py-2 text-sm ${safeViewDate.getFullYear() === year ? 'bg-blue-600 text-white' : 'hover:bg-gray-100'}`}>{year}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="relative flex items-center gap-2" ref={containerRef}>
      <div className="relative">
        <button
          onClick={() => (activeInput === 'start' ? setActiveInput(null) : openCalendar('start'))}
          className={`flex w-48 items-center justify-between rounded-lg border px-4 py-2 transition-all ${
            activeInput === 'start'
              ? 'border-blue-500 bg-white ring-2 ring-blue-100'
              : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
          }`}
        >
          <span className={`text-lg font-bold ${startDate ? 'text-gray-800' : 'text-gray-400'}`}>
            {formatDateDisplay(startDate) || '開始日'}
          </span>
          <CalendarIcon size={18} className={activeInput === 'start' ? 'text-blue-500' : 'text-gray-400'} />
        </button>
        {activeInput === 'start' && <div className="absolute top-full left-0 mt-2 z-50">{renderCalendarContent()}</div>}
      </div>
      <ArrowRight size={20} className="text-gray-300" />
      <div className="relative">
        <button
          onClick={() => (activeInput === 'end' ? setActiveInput(null) : openCalendar('end'))}
          className={`flex w-48 items-center justify-between rounded-lg border px-4 py-2 transition-all ${
            activeInput === 'end'
              ? 'border-blue-500 bg-white ring-2 ring-blue-100'
              : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
          }`}
        >
          <span className={`text-lg font-bold ${endDate ? 'text-gray-800' : 'text-gray-400'}`}>
            {formatDateDisplay(endDate) || '終了日'}
          </span>
          <CalendarIcon size={18} className={activeInput === 'end' ? 'text-blue-500' : 'text-gray-400'} />
        </button>
        {activeInput === 'end' && <div className="absolute top-full right-0 mt-2 z-50">{renderCalendarContent()}</div>}
      </div>
    </div>
  );
};

export default CustomRangePicker;
