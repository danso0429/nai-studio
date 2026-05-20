import React, {
  createContext,
  useContext,
  useState,
  memo,
  useEffect,
  ReactNode,
  useRef,
} from 'react';
import { FaTimes } from 'react-icons/fa';
// Capacitor not available in web mode
import { isMobile } from '../models';
import { appState } from '../models/AppService';

interface FloatView {
  id: number;
  component: ReactNode;
  priority: number;
  showToolbar?: boolean;
  onEscape?: () => void;
}

interface FloatViewContextProps {
  registerView: (view: FloatView) => void;
  unregisterView: (id: number) => void;
}

const FloatViewContext = createContext<FloatViewContextProps | undefined>(
  undefined,
);

export const useFloatView = (): FloatViewContextProps => {
  const context = useContext(FloatViewContext);
  if (!context) {
    throw new Error('useFloatView must be used within a FloatViewProvider');
  }
  return context;
};

interface FloatViewProviderProps {
  children: ReactNode;
}

export const FloatViewProvider: React.FC<FloatViewProviderProps> = ({
  children,
}) => {
  const [views, setViews] = useState<FloatView[]>([]);

  const registerView = (view: FloatView) => {
    setViews((prevViews) => [...prevViews, view].sort((a, b) => b.id - a.id));
    appState.incrementFloatView();
  };

  const unregisterView = (id: number) => {
    setViews((prevViews) => {
      const next = prevViews.filter((view) => view.id !== id);
      // Components M: viewId reset — 모든 view가 닫힌 시점에 module-level counter 0으로.
      // 옛 코드는 viewId가 zIndex로도 쓰여 monotonic 누적 시 32-bit 임계 (2^31) 초과 시
      // 브라우저 slow path. 본인 long-lived tab + N float view 빈번 시점에 결국 도달.
      if (next.length === 0) viewId = 0;
      return next;
    });
    appState.decrementFloatView();
  };

  // Components M: views state는 ref 패턴으로 — 옛 코드 deps[views]로 매 mount/unmount에
  // listener re-bind. ref capture하면 listener 한 번 bind + 항상 최신 views 참조.
  const viewsRef = useRef<FloatView[]>([]);
  viewsRef.current = views;

  const closeTopView = () => {
    const topView = viewsRef.current[0];
    if (topView && topView.onEscape) {
      topView.onEscape();
    }
  };

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && viewsRef.current.length > 0) {
        closeTopView();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  return (
    <FloatViewContext.Provider value={{ registerView, unregisterView }}>
      {children}
      {!!views.length && (
        <div
          className={
            'top-0 absolute w-full z-10 float-view ' +
            (views[0].showToolbar ? 'show-toolbar' : 'h-full')
          }
        >
          {views.map((view) => (
            <div
              key={view.id}
              className="bg-white dark:bg-slate-900 h-full w-full"
              style={{ position: 'absolute', zIndex: view.id }}
            >
              <div className="flex flex-col h-full w-full">
                <div className="flex-none border-b line-color">
                  <button
                    className="text-default button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      closeTopView();
                    }}
                  >
                    <FaTimes size={20} />
                  </button>
                </div>
                <div className="flex-1 overflow-hidden">{view.component}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </FloatViewContext.Provider>
  );
};

interface FloatViewProps {
  children: ReactNode;
  priority: number;
  showToolbar?: boolean;
  onEscape?: () => void;
}

let viewId = 0;

export const FloatView: React.FC<FloatViewProps> = memo(
  ({ children, priority, showToolbar, onEscape }) => {
    const { registerView, unregisterView } = useFloatView();
    const id = useRef(++viewId);

    useEffect(() => {
      const view = {
        id: id.current,
        component: children,
        priority,
        onEscape,
        showToolbar,
      };
      registerView(view);
      return () => unregisterView(id.current);
    }, []);

    return null;
  },
);
