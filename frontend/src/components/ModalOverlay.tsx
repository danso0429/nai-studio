import React, { ReactNode, useEffect, useCallback, useRef } from 'react';
import { FaTimes } from 'react-icons/fa';
import { appState } from '../models/AppService';

interface ModalOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  width?: string;
  hidden?: boolean;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const ModalOverlay = ({
  isOpen,
  onClose,
  title,
  children,
  width = 'max-w-xl',
  hidden = false,
}: ModalOverlayProps) => {
  const mouseDownOnBackdrop = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  // Tab 순환: focusable 끝에서 다음 Tab은 첫 element로, 첫에서 Shift+Tab은
  // 끝으로. modal 바깥 element로 focus 빠지는 것 방지.
  const handleTab = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !contentRef.current) return;
    const focusables = contentRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const inside = !!(active && contentRef.current.contains(active));
    if (e.shiftKey) {
      if (!inside || active === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (!inside || active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      window.addEventListener('keydown', handleEscape, true);
      window.addEventListener('keydown', handleTab, true);
      return () => {
        window.removeEventListener('keydown', handleEscape, true);
        window.removeEventListener('keydown', handleTab, true);
      };
    }
  }, [isOpen, handleEscape, handleTab]);

  // 모달 열림/닫힘 시 카운터 관리 (메타 D&D 차단용)
  useEffect(() => {
    if (isOpen) {
      appState.incrementModalOverlay();
      return () => appState.decrementModalOverlay();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center${hidden ? ' opacity-0 pointer-events-none' : ''}`}
      style={{
        zIndex: 'var(--z-modal)',
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
      onMouseDown={(e) => {
        // mousedown이 backdrop 자체에서 시작된 경우만 기록
        mouseDownOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        // mousedown도 backdrop에서 시작되고 click도 backdrop인 경우에만 닫기
        // (드래그로 밖에 나갔다 놓는 경우 방지)
        if (e.target === e.currentTarget && mouseDownOnBackdrop.current) {
          onClose();
        }
        mouseDownOnBackdrop.current = false;
      }}
    >
      <div
        ref={contentRef}
        className={`${width} w-[90vw] max-h-[85vh] bg-white dark:bg-slate-800 rounded-xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 dark:border-slate-600`}
      >
        {/* 타이틀 바 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-slate-600 flex-none">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
            {title}
          </h2>
          <button
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-500 dark:text-gray-400 transition-colors"
            onClick={onClose}
          >
            <FaTimes size={16} />
          </button>
        </div>
        {/* 콘텐츠 */}
        <div className="flex-1 overflow-auto p-5">{children}</div>
      </div>
    </div>
  );
};

export default ModalOverlay;
