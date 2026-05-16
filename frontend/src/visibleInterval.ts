// 백그라운드 탭에서 setInterval 자체를 정지시켜 모바일 발열·배터리 누수 차단.
// iOS Safari가 백그라운드 진입 시 timer를 throttle하긴 하지만 케이스마다 다르고,
// wake 직후 콜백이 한 번 도는 경우도 있어 timer 자체를 clear 하는 게 가장 확실해요.
// 포그라운드 복귀 시 interval 재등록만 (즉시 호출은 callsite가 정책에 따라 결정).

export function startVisibleInterval(
  fn: () => void,
  ms: number,
): () => void {
  let id: ReturnType<typeof setInterval> | null = null;

  const start = () => {
    if (id !== null) return;
    id = setInterval(fn, ms);
  };
  const stop = () => {
    if (id === null) return;
    clearInterval(id);
    id = null;
  };
  const handleVis = () => {
    if (document.visibilityState === 'visible') start();
    else stop();
  };

  document.addEventListener('visibilitychange', handleVis);
  if (document.visibilityState === 'visible') start();

  return () => {
    stop();
    document.removeEventListener('visibilitychange', handleVis);
  };
}
