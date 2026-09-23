import { useEffect, useState } from 'react';

import { serverNow } from '../../../shared/utils/serverClock';

export const useCustomerCurrentPeriod = (periods) => {
  const [currentPeriod, setCurrentPeriod] = useState(null);

  useEffect(() => {
    const checkPeriod = () => {
      // 端末の時計ではなくサーバー補正後の時刻で判定する(時計ズレで全商品非表示になる事故防止)
      const now = serverNow();
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
