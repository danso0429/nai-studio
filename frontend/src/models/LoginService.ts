import type { Backend } from '../backend';

export class LoginService extends EventTarget {
  loggedIn: boolean;
  // constructor의 async refresh()가 끝나기 전에 consumer가 loggedIn 읽으면
  // false (옛 값)로 잠시 UI flash. ResourceSyncService.dummyReady와 동일 패턴.
  refreshReady: Promise<void>;
  constructor(private readonly backend: Backend) {
    super();
    this.loggedIn = false;
    this.refreshReady = this.refresh();
  }

  async login(email: string, password: string) {
    await this.backend.login(email, password);
    await this.refresh(true);
  }

  async loginWithToken(token: string) {
    await this.backend.loginWithToken(token);
    await this.refresh(true);
  }

  // 저장된 토큰을 NAI로 실제 검증한다(파일 존재 확인이 아님 — 세션 중 만료를 감지). (SDStudio 4.13 630e0e5)
  // valid → ON, invalid(인증 거부) → OFF, error(네트워크 등 불확실) → 현재 상태 유지(오탐 방지).
  // 상태가 실제로 바뀔 때만(또는 force) 'change'를 발생시켜 재검증 루프를 방지한다.
  // 호출 빈도: 시작 1회(constructor) + 로그인 시도 직후 + TobBar 크레딧 조회 실패 시(만료 의심).
  // 상시 폴링하지 않아 NAI 부담은 낮다.
  async refresh(force = false) {
    let next = this.loggedIn;
    try {
      const validity = await this.backend.validateLogin();
      if (validity === 'valid') next = true;
      else if (validity === 'invalid') next = false;
      else {
        // 'error' = NAI가 401/403이 아닌 응답(400·5xx·네트워크 등)으로 검증 불가.
        // 초기값 false에 갇히지 않도록 *토큰 존재 여부로 폴백*(⑧ 이전 동작): 토큰이 있으면
        // 로그인 유지. NAI가 일시적으로 막아도(예: 400 "Please refresh NovelAI.net")
        // 명시 로그인/저장한 토큰으로 계속 쓸 수 있게 — 만료(401/403)만 로그아웃.
        next = await this.backend.authStatus();
      }
    } catch (e: any) {
      // 예기치 못한 오류 → 상태 유지
    }
    const changed = next !== this.loggedIn;
    this.loggedIn = next;
    if (changed || force) {
      this.dispatchEvent(new CustomEvent('change', {}));
    }
  }
}
