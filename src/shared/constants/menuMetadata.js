export const ALLERGEN_OPTIONS = [
  { id: 'egg', label: '卵' },
  { id: 'milk', label: '乳' },
  { id: 'wheat', label: '小麦' },
  { id: 'shrimp', label: 'えび' },
  { id: 'crab', label: 'かに' },
  { id: 'buckwheat', label: 'そば' },
  { id: 'peanut', label: '落花生' },
  { id: 'walnut', label: 'くるみ' }
];

export const getAllergenLabel = (allergenId) => (
  ALLERGEN_OPTIONS.find((option) => option.id === allergenId)?.label || allergenId
);
