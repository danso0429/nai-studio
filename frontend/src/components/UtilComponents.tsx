import React, {
  ReactNode,
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import Select, { GroupBase } from 'react-select';
import { isMobile } from '../models';
import {
  FaFileUpload,
  FaPuzzlePiece,
} from 'react-icons/fa';
import { Scrollbars } from 'react-custom-scrollbars-2';
import { FloatView } from './FloatView';
import { appState } from '../models/AppService';

export interface Option<T> {
  value: T;
  label: string;
}

interface DropdownSelectProps<T> {
  selectedOption: T | undefined;
  // 평면 옵션 또는 폴더식 그룹(react-select group). 그룹이면 label이 헤더로 뜨고
  // 하위 options가 들여쓰기로 묶임.
  options: ReadonlyArray<Option<T> | GroupBase<Option<T>>>;
  className?: string;
  menuPlacement?: 'top' | 'bottom' | 'auto';
  onSelect: (option: Option<T>) => void;
  disabled?: boolean;
}

export const DropdownSelect = <T,>({
  className,
  menuPlacement,
  selectedOption,
  options,
  disabled,
  onSelect,
}: DropdownSelectProps<T>) => {
  const handleChange = (selected: Option<T> | null) => {
    if (selected) {
      onSelect(selected);
    }
  };

  // 그룹/평면 혼합을 평탄화해 현재 선택값을 찾는다.
  const flatOptions: Option<T>[] = options.flatMap((o) =>
    'options' in o ? [...o.options] : [o],
  );

  return (
    <Select
      value={flatOptions.find((option) => option.value === selectedOption)}
      options={options}
      onChange={handleChange}
      menuPlacement={menuPlacement}
      menuPortalTarget={document.body}
      styles={{ menuPortal: (base) => ({ ...base, zIndex: 'var(--z-tooltip)' }) }}
      isDisabled={disabled}
      isSearchable={!isMobile}
      className={'my-react-select-container w-full ' + (className ?? '')}
      classNamePrefix="my-react-select"
    />
  );
};

export const FileUploadBase64: React.FC<{
  onFileSelect: (file: string) => void;
  disabled?: boolean;
  notext?: boolean;
}> = ({ onFileSelect, disabled, notext }) => {
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<any>(null);

  const handleDragEnter = (e: any) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  };

  const handleDragLeave = (e: any) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  };

  const handleDragOver = (e: any) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  };

  const handleDrop = (e: any) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      setFile(file);
      convertFileToBase64(file);
    }
  };

  const handleFileChange = (e: any) => {
    const file = e.target.files[0];
    if (file) {
      setFile(file);
      convertFileToBase64(file);
    }
  };

  const handleClick = () => {
    if (disabled) return;
    fileInputRef.current.click();
  };

  const convertFileToBase64 = (file: any) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      onFileSelect(base64String.split(',')[1]);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={handleClick}
      className="w-full h-8 overflow-hidden rounded-full back-sky clickable flex items-center justify-center"
      style={{
        backgroundColor: dragging ? '#0ea5e9' : undefined,
      }}
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
      />
      <p className="whitespace-nowrap">
        {file && !notext ? file.name : <FaFileUpload />}
      </p>
    </div>
  );
};

interface TabProps {
  label: string;
  shortLabel?: string;
  content: React.ReactNode;
  banToggle?: boolean;
  emoji: React.ReactNode;
  onClick?: () => void;
}

interface TabComponentProps {
  tabs: TabProps[];
  toggleView?: React.ReactNode;
  className?: string;
  left?: boolean;
  // 넘기면 활성 탭을 localStorage[persistKey]에 저장하고, *페이지 세션 첫 마운트에서만*
  // 복원. 프로젝트 전환(컴포넌트 key 리마운트)은 기존대로 0번 탭으로 리셋됨 — 복원은
  // PWA 부팅 1회로 한정(App 워크스페이스 탭 전용). prop 미전달 시 기존 동작(0번, 저장 X).
  persistKey?: string;
  onActiveTabChange?: (index: number) => void;
}

// persistKey별로 "이 페이지 세션에서 이미 복원했는지" 기록. 부팅 후 첫 마운트만 복원값을
// 소비하고, 이후 프로젝트 전환 리마운트는 0번으로(기존 동작 보존).
const consumedTabPersistKeys = new Set<string>();

export const TabComponent: React.FC<TabComponentProps> = ({
  left,
  tabs,
  toggleView,
  persistKey,
  onActiveTabChange,
}) => {
  const [activeTab, setActiveTab] = useState(() => {
    if (persistKey && !consumedTabPersistKeys.has(persistKey)) {
      consumedTabPersistKeys.add(persistKey);
      try {
        const n = parseInt(localStorage.getItem(persistKey) ?? '', 10);
        if (Number.isInteger(n) && n >= 0 && n < tabs.length) return n;
      } catch {
        // localStorage 접근 불가 — 복원만 skip.
      }
    }
    return 0;
  });
  const [toggleViewOpen, setToggleViewOpen] = useState(false);

  useEffect(() => {
    onActiveTabChange?.(activeTab);
  }, [activeTab, onActiveTabChange]);

  const handleTabClick = (index: number) => {
    tabs[index].onClick?.();
    setActiveTab(index);
    if (persistKey) {
      try {
        localStorage.setItem(persistKey, String(index));
      } catch {
        // 저장 실패 — 다음 부팅 복원만 영향, 현재 동작엔 무관.
      }
    }
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const action = (e as CustomEvent).detail?.action;
      if (typeof action === 'string' && action.startsWith('tab-')) {
        const tabIndex = parseInt(action.split('-')[1], 10) - 1;
        if (tabIndex >= 0 && tabIndex < tabs.length) {
          handleTabClick(tabIndex);
        }
      }
    };
    window.addEventListener('shortcut-action', handler);
    return () => window.removeEventListener('shortcut-action', handler);
  }, [tabs]);

  return (
    <div className="h-full flex flex-col px-1 md:p-2">
      <div
        className={
          'flex p-1 md:p-0 md:py-2 flex-none gap-2 items-center w-full mb-1 md:mb-0'
        }
      >
        <div className="md:flex gap-2 w-full hidden">
          {tabs.map((tab, index) => (
            <button
              key={index}
              className={
                'active:brightness-90 hover:brightness-95 select-none h-8 px-3 text-sm rounded-md transition-colors ' +
                (index === activeTab ? `back-sky` : 'back-llgray')
              }
              onClick={() => handleTabClick(index)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex md:hidden gap-1 w-full items-center">
          {!tabs[activeTab].banToggle && toggleView && (
            <button
              className="active:brightness-90 hover:brightness-95 select-none h-10 md:hidden text-sm back-llgray px-3 flex justify-center items-center"
              onClick={() => setToggleViewOpen(!toggleViewOpen)}
            >
              {toggleViewOpen ? '프롬프트 닫기' : '프롬프트 열기'}
            </button>
          )}
          {appState.curSession && (
            <button
              className="active:brightness-90 hover:brightness-95 select-none h-10 md:hidden text-sm back-green px-3 flex justify-center items-center"
              onClick={() => appState.openPieceEditor()}
              aria-label="프롬프트조각"
            >
              <FaPuzzlePiece size={16} />
            </button>
          )}
          <div className="flex gap-1 ml-auto min-w-0 flex-1">
            {tabs.map((tab, index) => (
              <button
                key={index}
                className={
                  'active:brightness-90 hover:brightness-95 select-none px-1 text-base h-10 rounded-md min-w-0 overflow-hidden flex items-center justify-center gap-1 ' +
                  (index === activeTab ? `back-sky flex-[2_1_0%]` : 'back-llgray flex-[1_1_0%]')
                }
                onClick={() => handleTabClick(index)}
                aria-label={tab.label}
                aria-current={index === activeTab ? 'page' : undefined}
                title={tab.label}
              >
                {tab.emoji}
                {index === activeTab && (
                  <span className="text-[11px] font-medium whitespace-nowrap truncate">
                    {tab.shortLabel ?? tab.label}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-hidden relative">
        {!tabs[activeTab].banToggle && toggleViewOpen && (
          <FloatView priority={0} onEscape={() => setToggleViewOpen(false)}>
            {toggleView}
          </FloatView>
        )}
        {tabs.map((tab, index) => (
          <div
            key={index}
            className="h-full overflow-auto"
            style={{ display: index === activeTab ? 'block' : 'none' }}
          >
            {tab.content}
          </div>
        ))}
      </div>
    </div>
  );
};

export const NumberSelect: React.FC<{
  n: number;
  selectedNumber: number;
  onChange: (num: number) => void;
}> = ({ n, selectedNumber, onChange }) => {
  const handleChange = (event: any) => {
    onChange(Number(event.target.value));
  };

  return (
    <select value={selectedNumber} onChange={handleChange}>
      {Array.from({ length: n }, (_, i) => (
        <option key={i} value={i}>
          prompt set {i}
        </option>
      ))}
    </select>
  );
};

export const Collapsible = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => {
  const [isOpen, setIsOpen] = useState(true);

  const toggleCollapse = () => {
    setIsOpen(!isOpen);
  };

  return (
    <div>
      <button onClick={toggleCollapse} className="button">
        {title}
      </button>
      <div style={{ display: isOpen ? 'block' : 'none', padding: '10px' }}>
        {children}
      </div>
    </div>
  );
};

export const TextAreaWithUndo = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) => {
  const textAreaRef = useRef<any>(null);
  useEffect(() => {
    if (value !== textAreaRef.current.value) {
      textAreaRef.current.value = value;
    }
  }, [value]);
  const handleChange = (e: any) => {
    const newValue = e.target.value;
    onChange(newValue);
  };
  return (
    <textarea
      className="clear-textarea h-full w-full bg-gray-200 p-2"
      ref={textAreaRef}
      onChange={handleChange}
    />
  );
};

export const CustomScrollbars = ({
  onScroll,
  forwardedRef,
  style,
  children,
}: any) => {
  const refSetter = useCallback((scrollbarsRef: any) => {
    if (scrollbarsRef) {
      forwardedRef(scrollbarsRef.view);
    } else {
      forwardedRef(null);
    }
  }, []);

  return (
    <Scrollbars
      ref={refSetter}
      style={{ ...style, overflow: 'hidden' }}
      onScroll={onScroll}
      renderThumbVertical={({ style: thumbStyle, ...props }) => (
        <div
          {...props}
          className="scrollbar-thumb"
          style={{ ...thumbStyle }}
        />
      )}
      renderTrackVertical={({ style: trackStyle, ...props }) => (
        <div
          {...props}
          className="scrollbar-track"
          style={{
            ...trackStyle,
            right: 2,
            bottom: 2,
            top: 2,
            borderRadius: 4,
          }}
        />
      )}
    >
      {children}
    </Scrollbars>
  );
};
