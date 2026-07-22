import { useCallback, useEffect, useRef } from 'react';

interface Props {
  /** 当前宽度 */
  size: number;
  /** 用户拖动时持续回调 */
  onResize: (next: number) => void;
  /** 拖动结束时回调（持久化） */
  onResizeEnd?: (next: number) => void;
  /** 最小/最大范围 */
  min: number;
  max: number;
  /** 方向：拖动时如何计算新宽度 */
  direction: 'horizontal' | 'vertical';
}

/**
 * 通用分割条。
 * - 鼠标按下后开始拖动
 * - 拖动时持续 onResize
 * - 松开时 onResizeEnd（可做持久化）
 * - 仅在拖动期间监听 mousemove/mouseup，避免全局副作用
 */
export function ResizeHandle(props: Props): JSX.Element {
  const draggingRef = useRef(false);
  const startPosRef = useRef(0);
  const startSizeRef = useRef(props.size);

  const onMove = useCallback(
    (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const delta =
        props.direction === 'horizontal' ? e.clientX - startPosRef.current : e.clientY - startPosRef.current;
      const next = Math.max(props.min, Math.min(props.max, startSizeRef.current + delta));
      props.onResize(next);
    },
    [props],
  );

  const onUp = useCallback(
    (e: MouseEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      const delta =
        props.direction === 'horizontal' ? e.clientX - startPosRef.current : e.clientY - startPosRef.current;
      const next = Math.max(props.min, Math.min(props.max, startSizeRef.current + delta));
      props.onResizeEnd?.(next);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    },
    [props, onMove],
  );

  const onDown = (e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    startPosRef.current = props.direction === 'horizontal' ? e.clientX : e.clientY;
    startSizeRef.current = props.size;
    document.body.style.cursor = props.direction === 'horizontal' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // 卸载时清理
  useEffect(
    () => () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    },
    [onMove, onUp],
  );

  return (
    <div
      className={`resize-handle resize-${props.direction}`}
      onMouseDown={onDown}
      title="拖动调整宽度"
    />
  );
}