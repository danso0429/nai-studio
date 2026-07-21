import React, { useState, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import {
  FaGlobe,
  FaUserAlt,
  FaTrashAlt,
  FaPen,
  FaDownload,
  FaCopy,
  FaTimes,
  FaUpload,
  FaFolder,
  FaFileExport,
  FaCheck,
} from 'react-icons/fa';
import { globalCharacterPresetService } from '../models';
import { appState } from '../models/AppService';
import { Session } from '../models/types';
import { IGlobalCharacterPresetEntry } from '../models/GlobalCharacterPresetService';
import ModalOverlayCountMarker from './ModalOverlayCountMarker';

// 글로벌 프리셋 카드 대표 이미지 (대표/레퍼런스/바이브 첫 장). 업스트림 GlobalCardImage 단순화.
const GlobalCardImage = ({
  entry,
  className,
}: {
  entry: IGlobalCharacterPresetEntry;
  className: string;
}) => {
  const [img, setImg] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p: any = entry.preset;
      const file =
        p.representativeImage ||
        p.characterReferences?.[0]?.path ||
        p.vibes?.[0]?.path;
      if (!file) {
        if (!cancelled) setImg(null);
        return;
      }
      const data = await globalCharacterPresetService.fetchImageData(file);
      if (!cancelled) setImg(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [entry]);
  if (img) return <img src={img} className={className} draggable={false} />;
  return (
    <div
      className={
        className +
        ' flex flex-col items-center justify-center bg-purple-50 dark:bg-purple-900/20'
      }
    >
      <FaUserAlt className="text-3xl text-purple-300 dark:text-purple-500 mb-1" />
      <span className="text-xs text-purple-400 dark:text-purple-300 truncate max-w-full px-2">
        {entry.name}
      </span>
    </div>
  );
};

// 글로벌(프로젝트 공통) 캐릭터 프리셋 — 최소 통합(드래그 정렬·cycling 모드는 업스트림에만,
// 여기선 저장/불러오기/이름변경/복제/삭제). 업스트림 CharacterPresetEditor 글로벌 부분 포팅.
const GlobalCharacterPresetDialog = observer(
  ({
    curSession,
    onClose,
  }: {
    curSession: Session;
    onClose: () => void;
  }) => {
    const presets = globalCharacterPresetService.presets;
    const [folderFilter, setFolderFilter] = useState('__all__');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const folders = globalCharacterPresetService.listFolders();
    const visiblePresets = presets.filter((entry) =>
      folderFilter === '__all__'
        ? true
        : folderFilter === '__unfiled__'
          ? !entry.folder
          : entry.folder === folderFilter,
    );

    // 이 프로젝트의 로컬 프리셋 중 하나를 골라 글로벌로 저장.
    const handleSaveLocalToGlobal = async () => {
      const locals = curSession.getCharacterPresets();
      if (!locals || locals.length === 0) {
        appState.pushMessage('이 프로젝트에 저장된 캐릭터 프리셋이 없어요');
        return;
      }
      const name = await appState.pushDialogAsync({
        type: 'select',
        text: '글로벌로 저장할 프리셋을 선택하세요',
        items: locals.map((p) => ({ text: p.name, value: p.name })),
      });
      if (!name) return;
      const preset = locals.find((p) => p.name === name);
      if (!preset) return;
      try {
        await globalCharacterPresetService.addFromSessionPreset(curSession, preset);
        appState.pushMessage(`"${name}"을(를) 글로벌로 저장했습니다`);
      } catch (e: any) {
        appState.pushMessage(e.message || '글로벌 저장에 실패했습니다');
      }
    };
    const handleLoad = async (entry: IGlobalCharacterPresetEntry) => {
      try {
        const p = await globalCharacterPresetService.instantiateIntoSession(curSession, entry.id);
        appState.pushMessage(`"${p.name}"을(를) 프로젝트로 불러왔습니다`);
      } catch (e: any) {
        appState.pushMessage(e.message || '불러오기에 실패했습니다');
      }
    };
    const handleRename = (entry: IGlobalCharacterPresetEntry) => {
      appState.pushDialog({
        type: 'input-confirm',
        text: '새 글로벌 프리셋 이름을 입력해주세요',
        callback: async (v?: string) => {
          if (!v) return;
          try {
            await globalCharacterPresetService.rename(entry.id, v);
          } catch (e: any) {
            appState.pushMessage(e.message || '이름 변경에 실패했습니다');
          }
        },
      });
    };
    const handleDelete = (entry: IGlobalCharacterPresetEntry) => {
      appState.pushDialog({
        type: 'confirm',
        text: `글로벌 프리셋 "${entry.name}"을(를) 삭제하시겠습니까?\n(이 작업은 모든 프로젝트에 영향을 줍니다)`,
        callback: async () => {
          try {
            await globalCharacterPresetService.delete(entry.id);
          } catch (e: any) {
            appState.pushMessage(e.message || '삭제에 실패했습니다');
          }
        },
      });
    };
    const handleDuplicate = (entry: IGlobalCharacterPresetEntry) => {
      globalCharacterPresetService.duplicateEntry(entry.id).catch((e: any) =>
        appState.pushMessage(e.message || '복제에 실패했습니다'),
      );
    };

    const handleSaveAllLocal = () => {
      const locals = curSession.getCharacterPresets();
      if (!locals.length) return;
      appState.pushDialog({
        type: 'confirm',
        text: `이 프로젝트의 캐릭터 프리셋 ${locals.length}개를 모두 글로벌로 복사할까요?`,
        callback: async () => {
          let success = 0;
          for (const preset of locals) {
            try {
              await globalCharacterPresetService.addFromSessionPreset(curSession, preset);
              success += 1;
            } catch {}
          }
          appState.pushMessage(`${success}개를 글로벌로 복사했습니다.`);
        },
      });
    };

    const handleCreateFolder = async () => {
      const name = await appState.pushDialogAsync({
        type: 'input-confirm',
        text: '새 글로벌 프리셋 폴더 이름',
      });
      if (!name) return;
      try {
        setFolderFilter(globalCharacterPresetService.createFolder(name));
      } catch (error: any) {
        appState.pushMessage(error?.message || '폴더를 만들 수 없습니다.');
      }
    };

    const chooseFolder = async (): Promise<string | null | undefined> => {
      const value = await appState.pushDialogAsync({
        type: 'select',
        text: '이동할 폴더',
        items: [
          { text: '미분류', value: '/unfiled' },
          ...globalCharacterPresetService.listFolders().map((folder) => ({
            text: `📁 ${folder}`,
            value: folder,
          })),
        ],
      });
      return value === undefined ? undefined : value === '/unfiled' ? null : value;
    };

    const moveSelected = async () => {
      const folder = await chooseFolder();
      if (folder === undefined) return;
      for (const id of selectedIds) globalCharacterPresetService.setFolder(id, folder);
      setSelectedIds(new Set());
    };

    const applySelected = async () => {
      const locals = [];
      for (const entry of presets.filter((candidate) => selectedIds.has(candidate.id))) {
        try {
          locals.push(
            await globalCharacterPresetService.instantiateIntoSession(curSession, entry.id),
          );
        } catch {}
      }
      appState.applyCharacterPresets(locals);
      setSelectedIds(new Set());
      onClose();
    };

    const exportAll = async () => {
      const blob = new Blob(
        [JSON.stringify(await globalCharacterPresetService.exportToFileData())],
        { type: 'application/json' },
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'global-character-presets.json';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    };

    const importFile = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const count = await globalCharacterPresetService.importFromFileData(
            JSON.parse(await file.text()),
          );
          appState.pushMessage(`${count}개 글로벌 캐릭터 프리셋을 불러왔습니다.`);
        } catch (error: any) {
          appState.pushMessage(error?.message || '불러오기에 실패했습니다.');
        }
      };
      input.click();
    };

    const iconBtn =
      'p-1.5 rounded text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700';

    return (
      <div
        className="fixed inset-0 z-[var(--z-feature-modal)] flex items-center justify-center bg-black/50"
        onClick={onClose}
      >
        <ModalOverlayCountMarker />
        <div
          className="bg-white dark:bg-gray-800 text-default rounded-lg w-full max-w-2xl max-h-[85vh] m-4 flex flex-col overflow-hidden border border-gray-300 dark:border-gray-600"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <span className="font-bold flex items-center gap-2">
              <FaGlobe className="text-purple-500" /> 글로벌 캐릭터 프리셋
            </span>
            <button
              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
              onClick={onClose}
            >
              <FaTimes size={18} />
            </button>
          </div>

          <div className="px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 flex flex-wrap gap-2">
            <button
              onClick={handleSaveLocalToGlobal}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-purple-500 hover:bg-purple-600 text-white transition-colors"
            >
              <FaUpload size={12} /> 이 프로젝트의 프리셋을 글로벌로 저장
            </button>
            <button className={iconBtn} title="이 프로젝트의 프리셋 모두 글로벌로 복사" onClick={handleSaveAllLocal}>
              모두
            </button>
            <button className={iconBtn} title="글로벌 프리셋 파일 저장" onClick={exportAll}><FaFileExport /></button>
            <button className={iconBtn} title="글로벌 프리셋 파일 불러오기" onClick={importFile}><FaUpload /></button>
          </div>

          <div className="px-3 py-2 border-b line-color flex gap-1.5 overflow-x-auto">
            <button className={`round-button text-xs ${folderFilter === '__all__' ? 'back-sky' : 'back-gray'}`} onClick={() => setFolderFilter('__all__')}>전체</button>
            <button className={`round-button text-xs ${folderFilter === '__unfiled__' ? 'back-sky' : 'back-gray'}`} onClick={() => setFolderFilter('__unfiled__')}>미분류</button>
            {folders.map((folder) => (
              <button key={folder} className={`round-button text-xs whitespace-nowrap ${folderFilter === folder ? 'back-sky' : 'back-gray'}`} onClick={() => setFolderFilter(folder)}>
                <FaFolder className="inline mr-1" />{folder}
              </button>
            ))}
            <button className="round-button text-xs back-green whitespace-nowrap" onClick={handleCreateFolder}>+ 폴더</button>
          </div>

          {selectedIds.size > 0 && (
            <div className="px-3 py-2 border-b line-color flex flex-wrap items-center gap-2">
              <span className="text-sm">{selectedIds.size}개 선택</span>
              <button className="round-button back-green" onClick={applySelected}>선택 적용</button>
              <button className="round-button back-gray" onClick={moveSelected}>폴더 이동</button>
              <button className="round-button back-gray" onClick={() => setSelectedIds(new Set())}>해제</button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-3 min-h-0">
            {presets.length === 0 ? (
              <div className="text-center text-sm text-gray-400 py-10">
                저장된 글로벌 프리셋이 없어요. 위 버튼으로 이 프로젝트의 프리셋을 저장해보세요.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {visiblePresets.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-lg border-2 border-purple-300 dark:border-purple-600 overflow-hidden bg-white dark:bg-slate-800"
                  >
                    <div className="relative aspect-[3/4]">
                      <button
                        className={`absolute z-10 top-1.5 right-1.5 w-6 h-6 rounded border flex items-center justify-center ${selectedIds.has(entry.id) ? 'bg-sky-500 text-white' : 'bg-white/80 text-gray-600'}`}
                        onClick={() => {
                          const next = new Set(selectedIds);
                          next.has(entry.id) ? next.delete(entry.id) : next.add(entry.id);
                          setSelectedIds(next);
                        }}
                      >
                        {selectedIds.has(entry.id) && <FaCheck size={12} />}
                      </button>
                      <GlobalCardImage entry={entry} className="w-full h-full object-cover" />
                      <div className="absolute top-1.5 left-1.5 bg-purple-500 text-white text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-1 shadow">
                        <FaGlobe size={9} /> 글로벌
                      </div>
                    </div>
                    <div className="p-2">
                      <div className="text-sm font-medium truncate" title={entry.name}>
                        {entry.name}
                      </div>
                      {entry.folder && <div className="text-[10px] text-sub truncate">📁 {entry.folder}</div>}
                      <div className="flex gap-0.5 mt-1.5">
                        <button onClick={() => handleLoad(entry)} title="이 프로젝트로 불러오기" className={iconBtn}>
                          <FaDownload size={13} />
                        </button>
                        <button onClick={() => handleRename(entry)} title="이름 변경" className={iconBtn}>
                          <FaPen size={13} />
                        </button>
                        <button onClick={() => handleDuplicate(entry)} title="복제" className={iconBtn}>
                          <FaCopy size={13} />
                        </button>
                        <button
                          onClick={() => handleDelete(entry)}
                          title="삭제 (모든 프로젝트에 영향)"
                          className={iconBtn + ' hover:text-red-500'}
                        >
                          <FaTrashAlt size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  },
);

export default GlobalCharacterPresetDialog;
