import { useCallback, useRef } from 'react';

// 모바일 longpress detection — iOS Safari가 이미지 위 꾹 누르면 OS callout
// 시트(미리보기 / 공유 / 저장)가 먼저 발화해서 우리 onContextMenu가 도달 X.
// 우회: 호출처에 (a) callout 차단 CSS + (b) 자체 touchstart timer + cancel
// pattern을 박아 자체 longpress로 react-contexify show() 직접 호출.
//
// 사용:
//   const lp = useLongPress({
//     onLongPress: (e, position) => show({ event: e, props, position }),
//   });
//   <img {...lp.handlers} style={{ ...lp.callout, ...other }} />
//
// desktop 마우스 우클릭은 onContextMenu 그대로 박아두면 같이 동작.

interface UseLongPressOpts {
  ms?: number;
  onLongPress: (
    e: React.TouchEvent,
    position: { x: number; y: number },
  ) => void;
  // touch move 허용 임계값 (px). 이 거리 넘으면 longpress cancel (scroll 회피).
  moveTolerance?: number;
}

export function useLongPress({
  ms = 500,
  onLongPress,
  moveTolerance = 10,
}: UseLongPressOpts) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef<{ x: number; y: number } | null>(null);
  const eventRef = useRef<React.TouchEvent | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startedAtRef.current = null;
    eventRef.current = null;
  }, []);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length !== 1) {
        clear();
        return;
      }
      const t = e.touches[0];
      const x = t.clientX;
      const y = t.clientY;
      startedAtRef.current = { x, y };
      eventRef.current = e;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const navAny = typeof navigator !== 'undefined' ? (navigator as any) : null;
        if (navAny && typeof navAny.vibrate === 'function') {
          try {
            navAny.vibrate(20);
          } catch {}
        }
        const ev = eventRef.current;
        const pos = startedAtRef.current;
        if (ev && pos) {
          onLongPress(ev, pos);
        }
      }, ms);
    },
    [ms, onLongPress, clear],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!startedAtRef.current || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - startedAtRef.current.x;
      const dy = t.clientY - startedAtRef.current.y;
      if (Math.hypot(dx, dy) > moveTolerance) {
        clear();
      }
    },
    [clear, moveTolerance],
  );

  return {
    handlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd: clear,
      onTouchCancel: clear,
    },
    // 이미지 영역에 spread해서 OS callout 시트 차단.
    callout: {
      WebkitTouchCallout: 'none' as const,
      WebkitUserSelect: 'none' as const,
      userSelect: 'none' as const,
    },
  };
}
