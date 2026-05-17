import { observable, action, makeObservable } from 'mobx';
import { backend, imageService } from '.';
import { GenericScene, InpaintScene, Session, CharacterPreset } from './types';

import { apiUrl, extractApiError } from './util';
import { appState } from './AppService';
import { cropMirrorResultFromDataUri, dataUriToBase64 } from './ImageService';
import { DownloadSettings } from '../main/config';

function isMirrorScene(scene: GenericScene): boolean {
  return scene.type === 'inpaint' && (scene as InpaintScene).workflowType === 'SDMirror';
}

function getMirrorCropX(scene: GenericScene): number | undefined {
  if (isMirrorScene(scene)) {
    return (scene as InpaintScene).mirrorCropX;
  }
  return undefined;
}

/**
 * 파일명에 사용할 수 없는 특수문자를 안전한 문자로 치환
 */
export function sanitizeFilename(filename: string): string {
  // Windows/Mac/Linux에서 파일명에 사용할 수 없는 문자들
  const invalidChars = /[<>:"/\\|?*]/g;
  // 연속된 공백을 하나로
  const multipleSpaces = /\s+/g;
  // 앞뒤 공백 및 점 제거
  const trimPattern = /^[\s.]+|[\s.]+$/g;

  let sanitized = filename
    .replace(invalidChars, '_')
    .replace(multipleSpaces, ' ')
    .replace(trimPattern, '');

  // 빈 문자열이면 기본값
  if (!sanitized) {
    sanitized = 'image';
  }

  // 최대 길이 제한 (확장자 제외 200자)
  if (sanitized.length > 200) {
    sanitized = sanitized.substring(0, 200);
  }

  return sanitized;
}

/**
 * 파일명 중복 시 자동 넘버링
 */
export async function getUniqueFilename(
  directory: string,
  baseFilename: string,
  extension: string,
  useAbsolutePath: boolean = false,
): Promise<string> {
  let filename = `${baseFilename}.${extension}`;
  let counter = 1;

  // 파일 존재 여부 확인 (최대 9999번까지). async 재귀 대신 while로 단순화.
  while (true) {
    const fullPath = `${directory}/${filename}`;
    const exists = useAbsolutePath
      ? await backend.existFileAbsolute(fullPath)
      : await backend.existFile(fullPath);
    if (!exists) return filename;
    if (counter > 9999) return `${baseFilename}_${Date.now()}.${extension}`;
    filename = `${baseFilename}_${counter}.${extension}`;
    counter += 1;
  }
}

/**
 * 파일명 생성 옵션
 */
export interface FilenameOptions {
  sceneName: string;
  prefix?: string;
  suffix?: string;
  includeTimestamp?: boolean;
  includeIndex?: boolean;
  index?: number;
  customName?: string;
}

/**
 * 파일명 생성
 */
export function generateFilename(options: FilenameOptions): string {
  const {
    sceneName,
    prefix = '',
    suffix = '',
    includeTimestamp = false,
    includeIndex = false,
    index = 0,
    customName,
  } = options;

  const parts: string[] = [];

  // 접두사
  if (prefix) {
    parts.push(sanitizeFilename(prefix));
  }

  // 메인 이름 (커스텀 이름 또는 씬 이름)
  if (customName) {
    parts.push(sanitizeFilename(customName));
  } else {
    parts.push(sanitizeFilename(sceneName));
  }

  // 접미사
  if (suffix) {
    parts.push(sanitizeFilename(suffix));
  }

  // 인덱스
  if (includeIndex && index > 0) {
    parts.push(index.toString().padStart(3, '0'));
  }

  // 타임스탬프
  if (includeTimestamp) {
    parts.push(Date.now().toString());
  }

  return parts.join('_');
}

/**
 * 이미지 다운로드 서비스
 */
export class ImageDownloadService {
  @observable accessor settings: DownloadSettings = {
    autoNumbering: true,
    overwriteExisting: false,
    includeTimestamp: false,
  };

  @observable accessor isDownloading: boolean = false;

  @observable accessor downloadProgress: number = 0;

  constructor() {
    makeObservable(this);
    this.loadSettings();
  }

  /**
   * 설정 로드
   */
  @action
  async loadSettings() {
    try {
      const config = await backend.getConfig();
      if (config.downloadSettings) {
        this.settings = { ...this.settings, ...config.downloadSettings };
      }
    } catch (e) {
      console.error('Failed to load download settings:', e);
    }
  }

  /**
   * 설정 저장
   */
  @action
  async saveSettings() {
    try {
      const config = await backend.getConfig();
      config.downloadSettings = this.settings;
      await backend.setConfig(config);
    } catch (e) {
      console.error('Failed to save download settings:', e);
    }
  }

  /**
   * 마지막 저장 경로 업데이트
   */
  @action
  async updateLastSavePath(path: string) {
    this.settings.lastSavePath = path;
    await this.saveSettings();
  }

  // prefix/suffix는 characterPreset 우선 → settings default → ''. 두 다운로드 경로에서 반복됨.
  private resolvePrefixSuffix(
    characterPreset?: CharacterPreset,
  ): { prefix: string; suffix: string } {
    return {
      prefix:
        characterPreset?.filenamePrefix || this.settings.defaultPrefix || '',
      suffix:
        characterPreset?.filenameSuffix || this.settings.defaultSuffix || '',
    };
  }

  /**
   * 단일 이미지 다운로드
   */
  // Drive-first 다운로드. Drive 가용시 exports/{filename}.png으로 쓰고 sync 큐 등록 →
  // Drive 폴더로 자동 업로드. 미가용시 브라우저 직접 다운로드(a.download).
  // 옛 selectDir/writeDataFileAbsolute 데스크탑 electron 경로는 SDStudio Remote(웹)에선
  // selectDir undefined라 무의미 — 단순화.
  async downloadSingleImage(
    _session: Session,
    scene: GenericScene,
    imagePath: string,
    characterPreset?: CharacterPreset,
    customFilename?: string,
  ): Promise<boolean> {
    try {
      const { prefix, suffix } = this.resolvePrefixSuffix(characterPreset);
      const baseFilename = customFilename
        ? sanitizeFilename(customFilename)
        : generateFilename({
            sceneName: scene.name,
            prefix,
            suffix,
            // Drive 업로드는 중복 회피용 timestamp 항상 권장. settings 덮어쓰기 X.
            includeTimestamp: this.settings.includeTimestamp,
          });
      const downloadName = `${baseFilename}.png`;

      await appState.refreshDriveRetryStatus();
      const driveAvailable = appState.driveRetryStatus?.driveAvailable !== false;

      if (driveAvailable) {
        // exports/{filename}.png에 쓰고 sync-exports 큐 등록 (Drive backup 폴더로 업로드).
        const exportPath = 'exports/' + downloadName;
        const imageData = await imageService.fetchImage(imagePath);
        if (!imageData) throw new Error('이미지를 읽을 수 없습니다');
        const base64 = isMirrorScene(scene)
          ? await cropMirrorResultFromDataUri(imageData, getMirrorCropX(scene))
          : dataUriToBase64(imageData);
        await backend.writeDataFile(exportPath, base64);

        try {
          const r = await fetch(apiUrl('/api/fs/sync-exports'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: exportPath }),
          });
          const data = await r.json();
          if (data.ok && data.queued) {
            appState.pushMessage(`✓ Drive 업로드 큐 등록: ${downloadName}`);
            return true;
          }
          // 큐 등록 실패 — fallback에 위임
          console.warn('[download] Drive 큐 등록 실패, 브라우저 다운로드로 fallback:', data);
        } catch (e) {
          console.warn('[download] Drive sync-exports 요청 실패:', e);
        }
      }

      // Drive 미가용 또는 큐 등록 실패 → 브라우저 직접 다운로드. customFilename 살리려 a.download 활용.
      await backend.copyToDownloads(imagePath, downloadName);
      appState.pushMessage(`다운로드 시작: ${downloadName}`);
      return true;
    } catch (e: any) {
      console.error('Failed to download image:', e);
      appState.pushMessage(`이미지 저장 실패: ${extractApiError(e)}`);
      return false;
    }
  }

  /**
   * 여러 이미지 일괄 다운로드
   */
  async downloadMultipleImages(
    _session: Session,
    scene: GenericScene,
    imagePaths: string[],
    characterPreset?: CharacterPreset,
  ): Promise<{ success: number; failed: number }> {
    const result = { success: 0, failed: 0 };

    if (imagePaths.length === 0) {
      return result;
    }

    try {
      // 저장 경로 선택 — selectDir 가능시만 절대 경로(desktop). 웹은 selectDir undefined →
      // 브라우저 다운로드로 N번 fallback.
      let savePath = this.settings.lastSavePath;
      if (!savePath) {
        savePath = await backend.selectDir();
        if (savePath) await this.updateLastSavePath(savePath);
      }

      this.isDownloading = true;
      this.downloadProgress = 0;

      const { prefix, suffix } = this.resolvePrefixSuffix(characterPreset);

      // 웹 fallback: 브라우저 N번 다운로드. autoNumbering/덮어쓰기 무관 (브라우저 다운로드는
      // 클라 측 파일명만 결정, 충돌은 OS가 처리).
      if (!savePath) {
        for (let i = 0; i < imagePaths.length; i++) {
          const baseFilename = generateFilename({
            sceneName: scene.name,
            prefix,
            suffix,
            includeTimestamp: this.settings.includeTimestamp,
            includeIndex: true,
            index: i + 1,
          });
          try {
            await backend.copyToDownloads(imagePaths[i], `${baseFilename}.png`);
            result.success += 1;
          } catch (e) {
            console.error(`Failed to download image ${imagePaths[i]}:`, e);
            result.failed += 1;
          }
          this.downloadProgress = ((i + 1) / imagePaths.length) * 100;
        }
        if (result.success > 0) appState.pushMessage(`${result.success}개 다운로드 시작`);
        if (result.failed > 0) appState.pushMessage(`${result.failed}개 다운로드 실패`);
        this.isDownloading = false;
        this.downloadProgress = 0;
        return result;
      }

      // 순차적으로 다운로드 처리
      const downloadImage = async (index: number): Promise<void> => {
        if (index >= imagePaths.length) {
          return;
        }

        const imagePath = imagePaths[index];

        try {
          // 파일명 생성
          const baseFilename = generateFilename({
            sceneName: scene.name,
            prefix,
            suffix,
            includeTimestamp: this.settings.includeTimestamp,
            includeIndex: true,
            index: index + 1,
          });

          // 중복 처리
          let finalFilename: string;
          if (this.settings.autoNumbering && !this.settings.overwriteExisting) {
            finalFilename = await getUniqueFilename(
              savePath!,
              baseFilename,
              'png',
              true,
            );
          } else {
            finalFilename = `${baseFilename}.png`;
          }

          // 이미지 데이터 읽기
          const imageData = await imageService.fetchImage(imagePath);
          if (!imageData) {
            throw new Error('이미지를 읽을 수 없습니다');
          }

          // SDMirror 씬이면 우측 절반만 크롭
          const base64 = isMirrorScene(scene)
            ? await cropMirrorResultFromDataUri(imageData, getMirrorCropX(scene))
            : dataUriToBase64(imageData);

          // 파일 저장 (절대 경로 사용)
          const fullPath = `${savePath}/${finalFilename}`;
          await backend.writeDataFileAbsolute(fullPath, base64);

          result.success += 1;
        } catch (e) {
          console.error(`Failed to download image ${imagePath}:`, e);
          result.failed += 1;
        }

        this.downloadProgress = ((index + 1) / imagePaths.length) * 100;

        // 다음 이미지 처리
        await downloadImage(index + 1);
      };

      await downloadImage(0);

      if (result.success > 0) {
        appState.pushMessage(`${result.success}개의 이미지가 저장되었습니다`);
      }
      if (result.failed > 0) {
        appState.pushMessage(`${result.failed}개의 이미지 저장에 실패했습니다`);
      }
    } catch (e: any) {
      console.error('Failed to download images:', e);
      appState.pushMessage(`이미지 저장 실패: ${extractApiError(e)}`);
    } finally {
      this.isDownloading = false;
      this.downloadProgress = 0;
    }

    return result;
  }

  /**
   * 저장 경로 변경
   */
  async changeSavePath(): Promise<string | undefined> {
    const newPath = await backend.selectDir();
    if (newPath) {
      await this.updateLastSavePath(newPath);
    }
    return newPath;
  }

  /**
   * 다운로드 설정 업데이트
   */
  @action
  async updateSettings(newSettings: Partial<DownloadSettings>) {
    this.settings = { ...this.settings, ...newSettings };
    await this.saveSettings();
  }
}
