import { useRef, useState } from 'react';

export const useDraggableList = (initialList = []) => {
  const sourceKey = JSON.stringify(initialList || []);
  const [draftList, setDraftList] = useState(null);
  const [draftSourceKey, setDraftSourceKey] = useState(null);
  const [draggedIdx, setDraggedIdx] = useState(null);

  const draggedIdxRef = useRef(null);
  const listRef = useRef(initialList || []);

  const list = draftList && draftSourceKey === sourceKey ? draftList : (initialList || []);
  listRef.current = list;

  const setList = (nextValue) => {
    const resolvedValue = typeof nextValue === 'function'
      ? nextValue(listRef.current)
      : nextValue;

    listRef.current = resolvedValue;
    setDraftList(resolvedValue);
    setDraftSourceKey(sourceKey);
  };

  const onDragStart = (index) => {
    draggedIdxRef.current = index;
    setDraggedIdx(index);
  };

  const onDragOver = (event, index) => {
    event.preventDefault();

    const currentDraggedIdx = draggedIdxRef.current;

    if (currentDraggedIdx === null || currentDraggedIdx === index) return;

    const nextList = [...listRef.current];
    const draggedItem = nextList[currentDraggedIdx];

    if (!draggedItem) return;

    nextList.splice(currentDraggedIdx, 1);
    nextList.splice(index, 0, draggedItem);

    draggedIdxRef.current = index;
    setDraggedIdx(index);
    setList(nextList);
  };

  const onDragEnd = (onSaveCallback) => {
    const latestList = listRef.current;

    draggedIdxRef.current = null;
    setDraggedIdx(null);

    if (typeof onSaveCallback === 'function') {
      onSaveCallback(latestList);
    }
  };

  return {
    list,
    setList,
    draggedIdx,
    onDragStart,
    onDragOver,
    onDragEnd
  };
};
