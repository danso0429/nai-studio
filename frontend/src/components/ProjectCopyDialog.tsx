import { useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { appState } from '../models/AppService';
import { DropdownSelect, Option } from './UtilComponents';
import { formatProjectNameConflict } from '../models/util';
import ModalOverlayCountMarker from './ModalOverlayCountMarker';

// 폴더 dropdown value 컨벤션: '' → 루트(폴더없음), '<폴더 path>' → 해당 폴더.
const ROOT_VALUE = '';

// 프로젝트 복제 / 다른 폴더로 복사 — 이름·폴더·이미지 포함을 한 화면에서 받는다(불러오기 패턴).
const ProjectCopyDialog = observer(() => {
  const req = appState.projectCopyRequest;

  const [name, setName] = useState('');
  const [folder, setFolder] = useState<string>(ROOT_VALUE);
  const [withImages, setWithImages] = useState(true);

  // 요청 바뀌면 default로 재초기화. 폴더 기본값 = 소스의 현재 폴더(없으면 루트).
  useEffect(() => {
    if (req) {
      setName(req.defaultName);
      setFolder(req.defaultFolder ?? ROOT_VALUE);
      setWithImages(true);
    }
  }, [req]);

  const folderOptions = useMemo<Option<string>[]>(() => {
    if (!req) return [];
    return [
      { value: ROOT_VALUE, label: '📂 폴더없음 (루트)' },
      ...req.availableFolders.map((f) => ({ value: f, label: `📁 ${f}` })),
    ];
  }, [req]);

  // 검증: 빈칸 / 기존 프로젝트 이름과 중복(이름은 전역 unique).
  const error = useMemo(() => {
    if (!req) return null;
    const trimmed = name.trim();
    if (!trimmed) return '이름을 입력해주세요';
    if (req.existingNames.includes(trimmed)) {
      return formatProjectNameConflict(req.existingFolderMap[trimmed] ?? null);
    }
    return null;
  }, [name, req]);

  if (!req) return null;

  const valid = !error;
  const handleConfirm = () => {
    if (!valid) return;
    req.onConfirm(name.trim(), folder === ROOT_VALUE ? null : folder, withImages);
  };

  // z-[3000]: 드로어(z-2100) 위 + ConfirmWindow/Alert(z-5000) 아래의 feature 모달 레이어.
  // (z-50이면 드로어 뒤로 가림 — 불러오기/복사 다이얼로그 공통.)
  return (
    <div className="fixed inset-0 z-[3000] flex justify-center items-start pt-12 bg-black/40">
      <ModalOverlayCountMarker />
      <div className="m-4 p-4 rounded-md shadow-xl bg-white dark:bg-slate-800 text-default w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="text-default font-medium mb-1 break-words">
          "{req.sourceName}" 복제 / 다른 폴더로 복사
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-300 mb-3">
          새 이름과 둘 폴더를 정해주세요. 이름은 전체에서 겹치면 안 돼요.
        </div>
        <div className="mb-3">
          <div className="text-sm text-default mb-1">새 프로젝트 이름</div>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={'gray-input' + (error ? ' ring-2 ring-red-500' : '')}
            placeholder="새 프로젝트 이름"
            autoFocus
          />
          {error && <div className="text-xs text-red-500 mt-1">⚠ {error}</div>}
        </div>
        <div className="mb-3">
          <div className="text-sm text-default mb-1">저장 폴더</div>
          <DropdownSelect
            selectedOption={folder}
            options={folderOptions}
            onSelect={(opt) => setFolder(opt.value)}
            menuPlacement="auto"
          />
        </div>
        <label className="flex items-center gap-2 mb-4 cursor-pointer text-sm text-default">
          <input
            type="checkbox"
            className="w-4 h-4 accent-sky-500"
            checked={withImages}
            onChange={(e) => setWithImages(e.target.checked)}
          />
          이미지도 함께 복사
        </label>
        <div className="flex gap-2">
          <button
            className="flex-1 px-4 py-2 rounded back-sky clickable disabled:opacity-40"
            disabled={!valid}
            onClick={handleConfirm}
          >
            복사
          </button>
          <button
            className="flex-1 px-4 py-2 rounded back-gray clickable"
            onClick={() => req.onCancel()}
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
});

export default ProjectCopyDialog;
