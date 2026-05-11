import { observer } from 'mobx-react-lite';
import { appState } from '../models/AppService';

const AlertWindow = observer(() => {
  const { messages } = appState;
  if (messages.length === 0) return null;
  return (
    <div
      className="fixed top-0 left-0 right-0 flex flex-col gap-2 px-2 mt-2 pointer-events-none"
      style={{ zIndex: 5000 }}
    >
      {messages.map((m) => (
        <div
          key={m.id}
          className="px-3 py-2 rounded-md shadow-lg bg-red-500 text-white text-xs sm:text-sm break-keep"
        >
          {m.text}
        </div>
      ))}
    </div>
  );
});

export default AlertWindow;
