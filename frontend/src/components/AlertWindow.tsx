import { observer } from 'mobx-react-lite';
import { appState } from '../models/AppService';

const AlertWindow = observer(() => {
  const { messages } = appState;
  if (messages.length === 0) return null;
  return (
    <div
      // 상단에 두면 TobBar(로고/크레딧/버튼 줄)를 가리고 클릭을 가로챔 → 하단 중앙으로.
      // 하단 바는 가변 높이라 App.tsx가 측정한 --bottombar-h 위에 띄워 footer를 안 가림.
      // (SDStudio 4.13 389d6fb 토스트 하단 이동을 우리 가변 footer에 맞춰 적응)
      className="fixed left-0 right-0 flex flex-col items-center gap-2 px-2 pointer-events-none"
      style={{ zIndex: 'var(--z-toast)', bottom: 'calc(var(--bottombar-h, 57px) + 8px)' }}
    >
      {messages.map((m) => (
        <div
          key={m.id}
          className="px-3 py-2 rounded-md shadow-lg bg-white dark:bg-slate-800 text-black dark:text-white text-xs sm:text-sm break-keep"
        >
          {m.text}
        </div>
      ))}
    </div>
  );
});

export default AlertWindow;
