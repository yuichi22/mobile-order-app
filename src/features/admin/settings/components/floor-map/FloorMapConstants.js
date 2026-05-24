export const FLOOR_GRID_SIZE = 20;

export const TABLE_STATUSES = {
  VACANT: { id: 'vacant', label: '空席', color: 'bg-white border-gray-300', icon: null },
  SEATED: { id: 'seated', label: '入店済', color: 'bg-blue-100 border-blue-500', icon: '👤' },
  DINING: { id: 'dining', label: '食事中', color: 'bg-green-100 border-green-500', icon: '🍴' },
  CHECK: { id: 'check', label: '会計待', color: 'bg-yellow-100 border-yellow-500', icon: '✋' },
  DIRTY: { id: 'dirty', label: '清掃待', color: 'bg-red-100 border-red-500', icon: '🧹' },
};