import { observer } from 'mobx-react-lite';
import { Item, Menu } from 'react-contexify';
import { sessionService, backend, imageService, isMobile, imageDownloadService } from '../models';
import { appState } from '../models/AppService';
import { dataUriToBase64, deleteImageFiles } from '../models/ImageService';
import { getUniqueFilename } from '../models/ImageDownloadService';
import {
  SceneContextAlt,
  StyleContextAlt,
  ContextMenuType,
  genericSceneFromJSON,
  GallaryImageContextAlt,
} from '../models/types';
import { oneTimeFlowMap, oneTimeFlows } from '../models/workflows/OneTimeFlows';
import { extractPromptDataFromBase64 } from '../models/util';

export const AppContextMenu = observer(() => {
  const duplicateScene = async (ctx: SceneContextAlt) => {
    const newScene = genericSceneFromJSON(ctx.scene.toJSON());
    let cnt = 0;
    const newName = () =>
      newScene.name + '_copy' + (cnt === 0 ? '' : cnt.toString());
    while (appState.curSession!.hasScene(newScene.type, newName())) {
      cnt++;
    }
    newScene.name = newName();
    appState.curSession!.addScene(newScene);
  };
  const moveSceneFront = (ctx: SceneContextAlt) => {
    const curSession = appState.curSession;
    curSession!.moveScene(ctx.scene, 0);
  };
  const moveSceneBack = (ctx: SceneContextAlt) => {
    const curSession = appState.curSession;
    curSession!.moveScene(ctx.scene, curSession!.scenes.size - 1);
  };
  const copySceneToProject = async (ctx: SceneContextAlt) => {
    const curSession = appState.curSession;
    if (!curSession) return;
    const allProjects = sessionService.list().filter((n) => n !== curSession.name);
    if (allProjects.length === 0) {
      appState.pushMessage('복사할 대상 프로젝트가 없습니다.');
      return;
    }
    // 폴더 구조로: folderList 순서대로 폴더별 그룹 + 미분류(루트)는 마지막.
    // 폴더가 하나도 없으면 기존 평면 dropdown 그대로.
    const folderOf = (n: string) => sessionService.folderMap[n] ?? null;
    const folderGroups = sessionService.folderList
      .map((f) => ({
        label: f,
        items: allProjects
          .filter((n) => folderOf(n) === f)
          .map((n) => ({ text: n, value: n })),
      }))
      .filter((g) => g.items.length > 0);
    const rootProjects = allProjects.filter((n) => !folderOf(n));
    const onPick = async (targetName?: string) => {
        if (!targetName) return;
        try {
          const targetSession = await sessionService.get(targetName);
          if (!targetSession) {
            appState.pushMessage('대상 프로젝트를 불러올 수 없습니다.');
            return;
          }
          const newScene = genericSceneFromJSON(ctx.scene.toJSON());
          // 이름 충돌 해결
          let name = newScene.name;
          let cnt = 0;
          const mkName = () => name + '_copy' + (cnt === 0 ? '' : cnt.toString());
          while (targetSession.hasScene(newScene.type, mkName())) cnt++;
          newScene.name = mkName();

          targetSession.addScene(newScene);

          const srcDir = imageService.getOutputDir(curSession, ctx.scene);
          const dstDir = imageService.getOutputDir(targetSession, newScene);
          try {
            const files = await backend.listFiles(srcDir);
            for (const f of files) {
              if (f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.webp')) {
                await backend.copyFile(srcDir + '/' + f, dstDir + '/' + f);
              }
            }
          } catch {
            // 이미지 없는 씬이면 무시
          }

          appState.pushMessage(`"${newScene.name}" 씬이 "${targetName}" 프로젝트로 복사되었습니다.`);
        } catch (e: any) {
          appState.pushMessage('씬 복사 실패: ' + (e?.message || e));
        }
    };
    if (folderGroups.length === 0) {
      appState.pushDialog({
        type: 'dropdown',
        text: '씬을 복사할 대상 프로젝트를 선택하세요',
        items: allProjects.map((n) => ({ text: n, value: n })),
        callback: onPick,
      });
    } else {
      const groups = [...folderGroups];
      if (rootProjects.length > 0) {
        groups.push({
          label: '미분류',
          items: rootProjects.map((n) => ({ text: n, value: n })),
        });
      }
      appState.pushDialog({
        type: 'dropdown',
        text: '씬을 복사할 대상 프로젝트를 선택하세요',
        dropdownGroups: groups,
        callback: onPick,
      });
    }
  };

  const handleSceneItemClick = ({ id, props }: any) => {
    const ctx = props.ctx as SceneContextAlt;
    if (id === 'duplicate') {
      duplicateScene(ctx);
    } else if (id === 'copy-to-project') {
      copySceneToProject(ctx);
    } else if (id === 'move-front') {
      moveSceneFront(ctx);
    } else if (id === 'move-back') {
      moveSceneBack(ctx);
    } else if (id === 'delete') {
      // audit M2 — confirm 동안 프로젝트 전환 시 가변 curSession을 쓰면 전환된 프로젝트에
      // ctx.scene(원래 프로젝트 소속)을 적용. dialog 연 시점 세션 캡처.
      const session = appState.curSession!;
      appState.pushDialog({
        type: 'confirm',
        text: '정말로 삭제하시겠습니까? (휴지통으로 이동)',
        callback: async () => {
          const { trashService } = await import('../models');
          await trashService.moveSceneToTrash(session, ctx.scene);
        },
      });
    }
  };
  const duplicateImage = async (ctx: GallaryImageContextAlt) => {
    if (!ctx.scene) return;
    for (const path of ctx.path) {
      const tmp = path.slice(0, path.lastIndexOf('/'));
      await backend.copyFile(path, tmp + '/' + Date.now().toString() + '.png');
    }
    imageService.refresh(appState.curSession!, ctx.scene);
    appState.pushMessage('이미지를 복제했습니다');
  };
  // 다른 씬으로 이미지 이동 — renameFile로 원본을 대상 씬 디렉토리로 옮김(복사 후
  // 삭제가 아니라 atomic 이동, PNG 바이트 그대로라 생성정보 유지). 원본이 즐겨찾기였으면
  // 대상 씬에서도 즐겨찾기 유지. 대상에 같은 파일명 있으면 getUniqueFilename으로 회피.
  const moveImage = (ctx: GallaryImageContextAlt) => {
    const srcScene = ctx.scene;
    // audit M2 — dropdown 선택(전환 가능) 후 callback이 가변 curSession을 쓰면 잘못된
    // 프로젝트의 씬을 대상으로 함. dialog 연 시점 세션 캡처해 items+callback 일관 사용.
    const session = appState.curSession!;
    appState.pushDialog({
      type: 'dropdown',
      text: '이미지를 어느 씬으로 이동할까요?',
      items: Array.from(session.scenes.keys())
        .filter((key) => !srcScene || key !== srcScene.name)
        .map((key) => ({ text: key, value: key })),
      callback: async (value) => {
        if (!value) return;

        const target = session.scenes.get(value);
        if (!target) {
          return;
        }
        const targetDir = imageService.getImageDir(session, target);

        let moved = 0;
        for (const path of ctx.path) {
          const fn = path.split('/').pop()!;
          const dot = fn.lastIndexOf('.');
          const base = dot >= 0 ? fn.slice(0, dot) : fn;
          const ext = dot >= 0 ? fn.slice(dot + 1) : 'png';
          const wasFav = !!srcScene?.mains.includes(fn);
          const newName = await getUniqueFilename(targetDir, base, ext);
          await backend.renameFile(path, targetDir + '/' + newName);
          // 즐겨찾기 이전: 원본 씬 mains에서 제거 + (즐겨찾기였으면) 대상 씬 mains에 추가.
          if (srcScene) {
            const idx = srcScene.mains.indexOf(fn);
            if (idx >= 0) srcScene.mains.splice(idx, 1);
          }
          if (wasFav) target.mains.push(newName);
          moved++;
        }
        if (srcScene) imageService.refresh(session, srcScene);
        imageService.refresh(session, target);
        appState.pushMessage(moved + '장의 이미지를 이동했습니다');
      },
    });
  };
  const clipboardImage = async (ctx: GallaryImageContextAlt) => {
    try {
      await backend.copyImageToClipboard(ctx.path[0]);
      appState.pushMessage('이미지를 클립보드에 복사했어요');
    } catch (e: any) {
      const msg = e?.message || String(e);
      appState.pushMessage(`클립보드 복사 실패: ${msg}`);
      console.error('Clipboard copy failed:', e);
    }
  };
  const favImage = (ctx: GallaryImageContextAlt) => {
    if (!ctx.scene) return;
    for (const path_ of ctx.path) {
      const path = path_.split('/').pop()!;
      if (ctx.scene.mains.includes(path)) {
        ctx.scene.mains.splice(ctx.scene.mains.indexOf(path), 1);
      } else {
        ctx.scene.mains.push(path);
      }
    }
  };
  const deleteImg = async (ctx: GallaryImageContextAlt) => {
    appState.pushDialog({
      type: 'confirm',
      text: '정말로 삭제하시겠습니까?',
      callback: async () => {
        await deleteImageFiles(appState.curSession!, ctx.path, ctx.scene);
      },
    });
  };
  const downloadImage = async (ctx: GallaryImageContextAlt) => {
    if (!ctx.scene) return;
    const characterPreset = appState.getAppliedCharacterPreset();
    if (ctx.path.length === 1) {
      // 단일 이미지 다운로드
      await imageDownloadService.downloadSingleImage(
        appState.curSession!,
        ctx.scene,
        ctx.path[0],
        characterPreset,
      );
    } else {
      // 다중 이미지 다운로드
      await imageDownloadService.downloadMultipleImages(
        appState.curSession!,
        ctx.scene,
        ctx.path,
        characterPreset,
      );
    }
  };
  const transformImage = async (ctx: GallaryImageContextAlt) => {
    const items = oneTimeFlows.map((x) => ({
      text: x.text,
      value: x.text,
    }));
    const menu = await appState.pushDialogAsync({
      text: '이미지 변형 방법을 선택하세요',
      type: 'select',
      items: items,
    });
    if (!menu) return;
    const menuItem = oneTimeFlowMap.get(menu)!;
    const input = menuItem.getInput
      ? await menuItem.getInput(appState.curSession!)
      : undefined;
    for (const p of ctx.path) {
      let image = await imageService.fetchImage(p);
      image = dataUriToBase64(image!);
      const job = await extractPromptDataFromBase64(image);
      menuItem.handler(
        appState.curSession!,
        ctx.scene!,
        image,
        undefined,
        job,
        input,
      );
    }
  };
  // 공통 dispatcher — 두 진입점이 ctx 형태(path 단일/배열)와 transform 지원 여부만 다름
  const dispatchImageAction = (id: string, ctx: any, supportTransform: boolean) => {
    if (id === 'duplicate') duplicateImage(ctx);
    else if (id === 'copy') moveImage(ctx);
    else if (id === 'clipboard') clipboardImage(ctx);
    else if (id === 'fav') favImage(ctx);
    else if (id === 'delete') deleteImg(ctx);
    else if (id === 'download') downloadImage(ctx);
    else if (id === 'transform' && supportTransform) transformImage(ctx);
  };
  const handleImageItemClick = ({ id, props }: any) => {
    const ctx2: GallaryImageContextAlt = {
      ...props.ctx,
      type: 'gallary_image',
      path: [props.ctx.path],
    };
    dispatchImageAction(id, ctx2, false);
  };
  const handleImageItemClick2 = ({ id, props }: any) => {
    dispatchImageAction(id, props.ctx, true);
  };
  const exportStyle = async (ctx: StyleContextAlt) => {
    await appState.exportPreset(appState.curSession!, ctx.preset);
  };
  const deleteStyle = async (ctx: StyleContextAlt) => {
    appState.pushDialog({
      type: 'confirm',
      text: '정말로 삭제하시겠습니까?',
      callback: async () => {
        const curSession = appState.curSession;
        const presets = appState.curSession!.presets.get(ctx.preset.type)!;
        if (presets.length === 1) {
          appState.pushMessage('그림체는 최소 한 개 이상이어야 합니다');
          return;
        }
        curSession!.removePreset(ctx.preset.type, ctx.preset.name);
      },
    });
  };
  const editStyle = async (ctx: StyleContextAlt) => {
    sessionService.styleEdit(ctx.preset, ctx.container);
  };
  const handleStyleItemClick = ({ id, props }: any) => {
    if (id === 'export') {
      exportStyle(props.ctx as StyleContextAlt);
    } else if (id === 'delete') {
      deleteStyle(props.ctx as StyleContextAlt);
    } else if (id === 'edit') {
      editStyle(props.ctx as StyleContextAlt);
    } else if (id === 'to-global') {
      const ctx = props.ctx as StyleContextAlt;
      appState.exportPresetToGlobal(ctx.session, ctx.preset);
    }
  };
  return (
    <>
      <Menu id={ContextMenuType.Scene}>
        <Item id="duplicate" onClick={handleSceneItemClick}>
          해당 씬 복제
        </Item>
        <Item id="copy-to-project" onClick={handleSceneItemClick}>
          다른 프로젝트로 씬 복사
        </Item>
        <Item id="move-front" onClick={handleSceneItemClick}>
          해당 씬 맨 위로
        </Item>
        <Item id="move-back" onClick={handleSceneItemClick}>
          해당 씬 맨 뒤로
        </Item>
        <Item id="delete" onClick={handleSceneItemClick}>
          해당 씬 삭제
        </Item>
      </Menu>
      <Menu id={ContextMenuType.GallaryImage}>
        <Item id="download" onClick={handleImageItemClick2}>
          이미지 다운로드
        </Item>
        <Item id="fav" onClick={handleImageItemClick2}>
          즐겨찾기 토글
        </Item>
        <Item id="transform" onClick={handleImageItemClick2}>
          이미지 변형
        </Item>
        <Item id="delete" onClick={handleImageItemClick2}>
          해당 이미지 삭제
        </Item>
        <Item id="duplicate" onClick={handleImageItemClick2}>
          해당 이미지 복제
        </Item>
        <Item id="copy" onClick={handleImageItemClick2}>
          다른 씬으로 이미지 이동
        </Item>
        {!isMobile && (
          <Item id="clipboard" onClick={handleImageItemClick2}>
            클립보드로 이미지 복사
          </Item>
        )}
      </Menu>
      <Menu id={ContextMenuType.Image}>
        <Item id="download" onClick={handleImageItemClick}>
          이미지 다운로드
        </Item>
        <Item id="fav" onClick={handleImageItemClick}>
          즐겨찾기 토글
        </Item>
        <Item id="duplicate" onClick={handleImageItemClick}>
          해당 이미지 복제
        </Item>
        <Item id="copy" onClick={handleImageItemClick}>
          다른 씬으로 이미지 이동
        </Item>
        {!isMobile && (
          <Item id="clipboard" onClick={handleImageItemClick}>
            클립보드로 이미지 복사
          </Item>
        )}
      </Menu>
      <Menu id={ContextMenuType.Style}>
        <Item id="export" onClick={handleStyleItemClick}>
          해당 그림체 내보내기
        </Item>
        <Item id="to-global" onClick={handleStyleItemClick}>
          글로벌 프리셋으로 저장
        </Item>
        <Item id="edit" onClick={handleStyleItemClick}>
          해당 그림체 편집
        </Item>
        <Item id="delete" onClick={handleStyleItemClick}>
          해당 그림체 삭제
        </Item>
      </Menu>
    </>
  );
});
