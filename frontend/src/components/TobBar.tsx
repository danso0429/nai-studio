import { useEffect, useState } from 'react';
import { FaFileImport } from 'react-icons/fa';
import { BuildInfoBadge } from './BuildInfo';
import ConfigScreen from './ConfigScreen';
import SessionSelect from './SessionSelect';
import { appState } from '../models/AppService';
import {
  loginService,
  backend,
  taskQueueService,
  imageService,
} from '../models';

const TobBar = () => {
  const [loggedIn, setLoggedIn] = useState(false);
  const [credits, setCredits] = useState(0);

  useEffect(() => {
    const onChange = () => {
      setLoggedIn(loginService.loggedIn);
      if (!loginService.loggedIn) {
        setCredits(0);
        return;
      }
      (async () => {
        try {
          const credits = await backend.getRemainCredits();
          setCredits(credits);
        } catch (e) {
          // 로그인 표기는 ON인데 크레딧 조회 실패 → 토큰 만료 의심 → 재검증.
          // (만료면 OFF로 전환 — refresh가 changed일 때만 change 발생 + !loggedIn early
          //  return으로 루프 종료. 네트워크 일시 오류면 'error'라 상태 유지) (SDStudio 4.13 630e0e5)
          loginService.refresh();
        }
      })();
    };
    // race fix: constructor refresh가 끝난 후 첫 setLoggedIn → UI flash 회피.
    loginService.refreshReady.then(onChange);
    loginService.addEventListener('change', onChange);
    taskQueueService.addEventListener('complete', onChange);
    imageService.addEventListener('encode-vibe', onChange);
    return () => {
      loginService.removeEventListener('change', onChange);
      taskQueueService.removeEventListener('complete', onChange);
      imageService.removeEventListener('encode-vibe', onChange);
    };
  }, []);

  const [settings, setSettings] = useState(false);

  // 단축키에서 환경설정 열기 이벤트 수신
  useEffect(() => {
    const handler = (e: Event) => {
      const action = (e as CustomEvent).detail?.action;
      if (action === 'open-config') {
        setSettings(true);
      }
    };
    window.addEventListener('shortcut-action', handler);
    return () => window.removeEventListener('shortcut-action', handler);
  }, []);

  return (
    <div className="titlebar-drag flex border-b line-color px-3 py-2 items-center select-none gap-2">
      <div className="titlebar-no-drag gap-3 hidden md:flex text-sky-500 font-bold dark:text-white">
        SDStudio
      </div>
      <p className="ml-auto mr-3 hidden md:block titlebar-no-drag">
        {!loggedIn ? (
          <span className={`round-tag back-red`}>
            환경설정에서 로그인하세요
          </span>
        ) : (
          <>
            <BuildInfoBadge variant="desktop" />
            <span className="text-sub">Anlas: </span>{' '}
            <span className={`round-tag back-yellow`}>{credits}</span>
          </>
        )}
      </p>
      <button
        className="titlebar-no-drag round-button back-gray flex items-center gap-1"
        onClick={() => appState.openSceneImporter()}
        title="씬 일괄 임포트"
      >
        <FaFileImport size={12} />
        <span className="hidden md:inline">씬 임포트</span>
      </button>
      <button
        className={`titlebar-no-drag round-button back-sky`}
        onClick={() => {
          setSettings(true);
        }}
      >
        환경설정
      </button>
      <div className="md:hidden ml-2 titlebar-no-drag flex flex-col items-end gap-0.5">
        {!loggedIn ? (
          <span className={`round-tag back-red text-xs`}>로그인 필요</span>
        ) : (
          <span className={`round-tag back-yellow text-xs`}>{credits}</span>
        )}
      </div>
      <div className="ml-auto block md:hidden titlebar-no-drag">
        <SessionSelect />
      </div>

      {settings && (
        <ConfigScreen
          onSave={() => {
            setSettings(false);
          }}
          onClose={() => {
            setSettings(false);
          }}
        />
      )}
    </div>
  );
};

export default TobBar;
