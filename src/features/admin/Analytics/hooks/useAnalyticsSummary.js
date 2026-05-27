import { useMemo } from 'react';

import { buildAnalyticsSummary } from '../utils/analyticsHelpers';

export const useAnalyticsSummary = ({
  orders,
  period,
  currentDate,
  customRange,
  itemCategoryMap,
  categoryColorMap,
  isDayOfWeekMode,
  abcThresholds,
  categories,
  businessSettings,
  weeklyBaseDate,
  periods,
  selectedPeriodId = 'all'
}) => useMemo(() => buildAnalyticsSummary({
  orders,
  period,
  currentDate,
  customRange,
  itemCategoryMap,
  categoryColorMap,
  isDayOfWeekMode,
  abcThresholds,
  categories,
  businessSettings,
  weeklyBaseDate,
  periods,
  selectedPeriodId
}), [
  orders,
  period,
  currentDate,
  customRange,
  itemCategoryMap,
  categoryColorMap,
  isDayOfWeekMode,
  abcThresholds,
  categories,
  businessSettings,
  weeklyBaseDate,
  periods,
  selectedPeriodId
]);
