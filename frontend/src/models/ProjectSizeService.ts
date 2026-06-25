import { observable, makeObservable, runInAction } from 'mobx';
import { backend, sessionService } from '.';
import { apiUrl } from './util';

export interface ProjectSizeEntry {
  bytes: number;
  at: number; // 계산 시각 (epoch ms)
}

const SIDECAR_PATH = 'project_sizes.json';

/**
 * 프로젝트별 차지 용량 수동 계산 서비스 (SDStudio 4.12 ⑤)
 *
 * - 자동 계산하지 않음(부하 방지). 환경설정 → '프로젝트별 저장 공간'에서 수동 트리거.
 * - 결과는 사이드카 project_sizes.json 에 저장되어 재시작 후에도 유지.
 * - 용량 계산은 **서버**(`/api/project/size`)에서 재귀 합산한다. upstream은 클라가
 *   listFiles를 재귀 호출했지만, 우리 환경(클라→서버 HTTP)에선 라운드트립이 폭증하므로
 *   서버 sumDirAll로 1콜에 계산하도록 적응했다.
 */
export class ProjectSizeService {
  @observable accessor entries: Record<string, ProjectSizeEntry> = {};
  @observable accessor calculating: string[] = [];
  @observable accessor bulkProgress: { done: number; total: number } | undefined =
    undefined;

  private loaded = false;
  private bulkCancelled = false;

  constructor() {
    makeObservable(this);
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = JSON.parse(await backend.readFile(SIDECAR_PATH));
      if (raw && raw.entries) {
        runInAction(() => {
          this.entries = raw.entries;
        });
      }
    } catch (e) {
      // 파일 없음/파손 → 빈 캐시로 시작 (다시 계산하면 복구됨)
    }
    // 삭제·이름 변경된 프로젝트의 캐시 제거
    try {
      const names = new Set(sessionService.list());
      runInAction(() => {
        for (const k of Object.keys(this.entries)) {
          if (!names.has(k)) delete this.entries[k];
        }
      });
    } catch (e) {}
  }

  private async save(): Promise<void> {
    try {
      await backend.writeFile(
        SIDECAR_PATH,
        JSON.stringify({ version: 1, entries: this.entries }),
      );
    } catch (e) {
      console.error('프로젝트 용량 캐시 저장 실패:', e);
    }
  }

  private async fetchProjectBytes(name: string): Promise<number> {
    const res = await fetch(
      apiUrl('/api/project/size?name=' + encodeURIComponent(name)),
    );
    if (!res.ok) throw new Error('용량 계산 실패: ' + res.status);
    const data = await res.json();
    return data.bytes || 0;
  }

  async calculate(name: string): Promise<void> {
    if (this.calculating.includes(name)) return;
    runInAction(() => {
      this.calculating.push(name);
    });
    try {
      await this.ensureLoaded();
      const bytes = await this.fetchProjectBytes(name);
      runInAction(() => {
        this.entries[name] = { bytes, at: Date.now() };
      });
      await this.save();
    } finally {
      runInAction(() => {
        this.calculating = this.calculating.filter((n) => n !== name);
      });
    }
  }

  async calculateAll(names: string[]): Promise<void> {
    if (this.bulkProgress) return;
    this.bulkCancelled = false;
    runInAction(() => {
      this.bulkProgress = { done: 0, total: names.length };
    });
    try {
      for (let i = 0; i < names.length; i++) {
        if (this.bulkCancelled) break;
        try {
          await this.calculate(names[i]);
        } catch (e) {
          console.error('프로젝트 용량 계산 실패:', names[i], e);
        }
        runInAction(() => {
          this.bulkProgress = { done: i + 1, total: names.length };
        });
      }
    } finally {
      runInAction(() => {
        this.bulkProgress = undefined;
      });
    }
  }

  cancelBulk(): void {
    this.bulkCancelled = true;
  }

  // 전체 백업(이미지 포함) 예상 용량(바이트). 백업 시작 전 경고용 (② 지원).
  // 서버가 모든 프로젝트 + 글로벌 이미지 디렉터리를 재귀 합산한다.
  async estimateFullBackupBytes(): Promise<number> {
    const res = await fetch(apiUrl('/api/backup/estimate'));
    if (!res.ok) throw new Error('백업 용량 추정 실패: ' + res.status);
    const data = await res.json();
    return data.bytes || 0;
  }
}
