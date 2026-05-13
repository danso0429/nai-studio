import React, { useEffect, useState, useCallback, memo } from 'react';
import { FaObjectGroup } from 'react-icons/fa';
import { GenericScene } from '../models/types';
import { imageService, gameService } from '../models';
import { appState } from '../models/AppService';

interface SceneSelectorProps {
  text: string;
  scenes: GenericScene[];
  getImage: (scene: GenericScene) => Promise<string | null>;
  onConfirm: (selectedScenes: GenericScene[]) => void;
}

const SceneImage: React.FC<{
  scene: GenericScene;
  getImage: (scene: GenericScene) => Promise<string | null>;
}> = memo(({ scene, getImage }) => {
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const loadImage = useCallback(async () => {
    setLoading(true);
    try {
      const uri = await getImage(scene);
      setImage(uri);
    } catch (e) {
      setImage(null);
    } finally {
      setLoading(false);
    }
  }, [scene, getImage]);

  useEffect(() => {
    loadImage();

    const handleImageUpdate = () => {
      loadImage();
    };

    gameService.addEventListener('updated', handleImageUpdate);
    imageService.addEventListener('updated', handleImageUpdate);

    return () => {
      gameService.removeEventListener('updated', handleImageUpdate);
      imageService.removeEventListener('updated', handleImageUpdate);
    };
  }, [loadImage]);

  return (
    <div className="w-20 h-20 flex items-center justify-center">
      {image ? (
        <img
          className="bg-checkboard w-auto h-auto max-w-20 max-h-20"
          draggable={false}
          src={image}
          alt={scene.name}
        />
      ) : loading ? (
        <div className="w-16 h-16 bg-gray-200 dark:bg-slate-600 animate-pulse rounded" />
      ) : null}
    </div>
  );
});
SceneImage.displayName = 'SceneImage';

const SceneCard: React.FC<{
  scene: GenericScene;
  selected: boolean;
  getImage: (scene: GenericScene) => Promise<string | null>;
  onToggle: (scene: GenericScene) => void;
}> = memo(({ scene, selected, getImage, onToggle }) => {
  const handleClick = useCallback(() => onToggle(scene), [scene, onToggle]);
  return (
    <div
      // touch-manipulation: iOS Safari가 zoom 가능한 페이지에서 클릭 시
      // 적용하는 300-500ms tap delay 제거. 본인 보고 "씬 클릭 0.5~1초 뒤
      // selected 표시"의 원인.
      className={
        'touch-manipulation hover:brightness-95 active:brightness-90 cursor-pointer p-2 border flex-none flex flex-col items-center ' +
        (selected
          ? 'border-sky-500 dark:border-sky-500 bg-sky-200 dark:bg-slate-700'
          : 'bg-white dark:bg-slate-800  border-gray-400 dark:border-slate-400')
      }
      onClick={handleClick}
    >
      <div>
        <SceneImage getImage={getImage} scene={scene} />
      </div>
      <div className="h-12 w-16 md:w-28 overflow-auto break-all select-none">
        {scene.name}
      </div>
    </div>
  );
});
SceneCard.displayName = 'SceneCard';

const SceneSelector: React.FC<SceneSelectorProps> = ({
  scenes,
  text,
  getImage,
  onConfirm,
}) => {
  const { curSession } = appState;
  // 선택 상태는 씬 이름의 Set으로 관리해 has/add/delete가 모두 O(1).
  // 기존엔 GenericScene[]에 .some()을 매 카드 render마다 호출 → O(N²) per click.
  const [selectedNames, setSelectedNames] = useState<Set<string>>(() => new Set());

  // mount 시 refreshBatch 호출 제거. 60개 동시 fetch + 'updated' broadcast가
  // 60 SceneImage listener를 한꺼번에 깨워 main thread를 점유 → 클릭 응답 지연
  // 원인 후보. 모달 열기 직전 SceneQueueControl 화면에서 이미 refresh됐을 가능성
  // 높아 stale 위험 작음.

  const toggleSceneSelection = useCallback((scene: GenericScene) => {
    setSelectedNames((prev) => {
      const next = new Set(prev);
      if (next.has(scene.name)) next.delete(scene.name);
      else next.add(scene.name);
      return next;
    });
  }, []);

  const selectAllScenes = useCallback(() => {
    setSelectedNames(new Set(scenes.map((s) => s.name)));
  }, [scenes]);

  const clearAllSelections = useCallback(() => {
    setSelectedNames(new Set());
  }, []);

  const handleConfirm = useCallback(() => {
    const selected = scenes.filter((s) => selectedNames.has(s.name));
    onConfirm(selected);
  }, [scenes, selectedNames, onConfirm]);

  return (
    <div className="p-2 md:p-4 flex flex-col h-full">
      <div className="flex items-center gap-2 text-gray-700 dark:text-gray-200 flex-none">
        <FaObjectGroup className="text-lg md:text-xl" />
        <div className="text-lg md:text-xl flex flex-col md:flex-row md:gap-2">
          {' '}
          <span>씬을 선택하고 해당 작업을 적용합니다:</span>{' '}
          <span className="font-bold text-default">{text}</span>
        </div>
      </div>
      <div className="px-1 pt-2 md:pt-3 flex flex-col flex-1 overflow-hidden">
        <div className="gap-2 flex flex-none overflow-hidden">
          <button className={`round-button back-sky`} onClick={selectAllScenes}>
            모두 선택
          </button>
          <button
            className={`round-button back-gray`}
            onClick={clearAllSelections}
          >
            모두 선택 해제
          </button>
        </div>
        <div className="flex-1 overflow-hidden pt-4 pb-2">
          <div className="flex flex-wrap h-full overflow-auto gap-2 content-start text-sub">
            {scenes.map((scene) => (
              <SceneCard
                key={scene.name}
                scene={scene}
                selected={selectedNames.has(scene.name)}
                getImage={getImage}
                onToggle={toggleSceneSelection}
              />
            ))}
          </div>
        </div>
        <div className="flex-none flex">
          <button
            className={`round-button back-green ml-auto`}
            onClick={handleConfirm}
          >
            작업 적용
          </button>
        </div>
      </div>
    </div>
  );
};

export default SceneSelector;
