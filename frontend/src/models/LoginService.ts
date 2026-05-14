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
    try {
      await backend.readFile('TOKEN.txt');
      this.loggedIn = true;
    } catch (e: any) {
      this.loggedIn = false;
    }
    this.dispatchEvent(new CustomEvent('change', {}));
  }
}
