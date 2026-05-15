import { backend } from '.';

export class LoginService extends EventTarget {
  loggedIn: boolean;
  // constructor의 async refresh()가 끝나기 전에 consumer가 loggedIn 읽으면
  // false (옛 값)로 잠시 UI flash. ResourceSyncService.dummyReady와 동일 패턴.
  refreshReady: Promise<void>;
  constructor() {
    super();
    this.loggedIn = false;
    this.refreshReady = this.refresh();
  }

  async login(email: string, password: string) {
    await backend.login(email, password);
    await this.refresh();
  }

  async loginWithToken(token: string) {
    await backend.loginWithToken(token);
    await this.refresh();
  }

  async refresh() {
    // 보안 권고 H2(2026-05-15) 이후 /api/fs/read?path=TOKEN.txt 차단됨 — 별도
    // /api/auth/status로 메모리 + disk 체크. NAI 호출 0이라 cheap.
    try {
      this.loggedIn = await backend.authStatus();
    } catch (e: any) {
      this.loggedIn = false;
    }
    this.dispatchEvent(new CustomEvent('change', {}));
  }
}
