import { useEffect, useState } from 'react';

export const useCustomerCurrentPeriod = (periods) => {
  const [currentPeriod, setCurrentPeriod] = useState(null);

  useEffect(() => {
    const checkPeriod = () => {
      const now = new Date();
      const nowMinutes = now.getHours() * 60 + now.getMinutes();

      const foundPeriod = periods.find((period) => {
        if (!period.start || !period.end) return false;

        const [startHour, startMinute] = period.start.split(':').map(Number);
        const [endHour, endMinute] = period.end.split(':').map(Number);
        const startTotal = startHour * 60 + startMinute;
        const endTotal = endHour * 60 + endMinute;

        if (startTotal <= endTotal) {
          return nowMinutes >= startTotal && nowMinutes < endTotal;
        }

        return nowMinutes >= startTotal || nowMinutes < endTotal;
      });

      setCurrentPeriod(foundPeriod || null);
    };

    checkPeriod();
    const timer = setInterval(checkPeriod, 60000);
    return () => clearInterval(timer);
  }, [periods]);

  return currentPeriod;
};
