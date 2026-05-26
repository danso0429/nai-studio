import { observer } from 'mobx-react-lite';
import { Item, Menu } from 'react-contexify';
import { sessionService, backend, imageService, isMobile, imageDownloadService } from '../models';
import { appState } from '../models/AppService';
import { dataUriToBase64, deleteImageFiles } from '../models/ImageService';
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
    appState.pushDialog({
      type: 'dropdown',
      text: '씬을 복사할 대상 프로젝트를 선택하세요',
      items: allProjects.map((n) => ({ text: n, value: n })),
      callback: async (targetName) => {
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
      },
    });
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
      appState.pushDialog({
        type: 'confirm',
        text: '정말로 삭제하시겠습니까? (휴지통으로 이동)',
        callback: async () => {
          const { trashService } = await import('../models');
          await trashService.moveSceneToTrash(appState.curSession!, ctx.scene);
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
  const copyImage = (ctx: GallaryImageContextAlt) => {
    appState.pushDialog({
      type: 'dropdown',
      text: '이미지를 어디에 복사할까요?',
      items: Array.from(appState.curSession!.scenes.keys()).map((key) => ({
        text: key,
        value: key,
      })),
      callback: async (value) => {
        if (!value) return;

        const scene = appState.curSession!.scenes.get(value);
        if (!scene) {
          return;
        }

        for (const path of ctx.path) {
          await backend.copyFile(
            path,
            imageService.getImageDir(appState.curSession!, scene) +
              '/' +
              Date.now().toString() +
              '.png',
          );
        }
        imageService.refresh(appState.curSession!, scene);
        appState.pushMessage('이미지를 복사했습니다');
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
    else if (id === 'copy') copyImage(ctx);
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
          다른 씬으로 이미지 복사
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
          다른 씬으로 이미지 복사
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
