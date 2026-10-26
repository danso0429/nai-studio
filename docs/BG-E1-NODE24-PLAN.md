# E1 계획 — Node 24 LTS 전환

**상태 (2026-10-26 KST):** 계획 작성, Astra 계획 검수 2회 반영(§9). E1-1 완료(patcher `7c84a00`, 0.2.4-experimental.88: gate 24·25 각 19/19, probe sandbox 17/17·worker 12/12·host 197/197 양쪽 동일, Codex 코드 검수 지적 0건). E1-2 완료(Node 24 전역 도구 4종 설치, PM2 daemon 무변경). E1-3 이후 미착수, live 변경 전. 정본: [ordered goals](BG-PRESERVE-ORDERED-GOALS.md) 머리말 「G2.2 뒤 다음 순서」 E1.
**위험 분류:** risky. live 런타임·PM2·systemd unit·전역 셸 설정을 바꾸는 install/revert 성격이고, patcher의 플러그인 sandbox 보안 경계 코드를 바꾸는 단위(E1-1)를 포함한다.

## 1. 목표

지원이 끝난 Node 25.9.0에서 Node 24 LTS(24.22.1)로 옮긴다. 대상은 live PocketRisu 프로세스, PM2 daemon과 logrotate, PM2 systemd unit, 새 로그인·대화식 셸의 기본 Node(그 아래에서 시작하는 Claude/Codex 새 세션·MCP·후보 gate·probe)다. 사용자 데이터와 기존 기능(BG 플러그인 host 포함)은 그대로 유지한다. Node 25.9.0은 rollback용으로 설치를 유지한다.

## 2. 사용자 결정 (2026-10-26)

| 주제 | 결정 |
|---|---|
| 전환 방식 | 짧은 계획 재시작. 격리 검증을 마친 뒤 진행 중인 생성이 없을 때 stop → 교체 → start. 2026-10-21 인수인계의 「무중단 절대 우선」과 병렬 인스턴스 방식은 대체한다(병렬 운영은 같은 DB·메모리 잠금·BG registry·시작 시 복구 때문에 안전성을 입증하지 못했다). |
| 범위 | live 프로세스, PM2 daemon·systemd unit, `.profile`·nvm default. |
| Node 25 | 제거하지 않는다(rollback용). |
| 범위 밖 | `pnpm audit` Critical/High 정비와 MCP 인증정보 회전. 별도 과제로 둔다. 의존성 정비는 lockfile이 바뀌는 E2 뒤에 보는 편이 중복이 적다. |
| 목표 버전 | Node 24. 근거는 §4. |
| live patcher (E1-4) | 현재 live 그대로 둔다(lazy-chat-bg-adapter 0.7.62). live env에 `POCKETRISU_BG_PLUGIN_HOST_CANDIDATE`가 없어 플러그인 host가 꺼져 있으므로 sandbox 버전 조건은 쓰이지 않는다. host를 켜기 전에 E1-1을 포함한 patcher(0.2.4-experimental.88, adapter 0.7.83 이상)를 먼저 적용한다. E1-3 검증 대상은 live 앱 트리의 사본이다. |
| opencode CLI | Node 24에는 설치하지 않는다. Node 25 전역에만 남는다. |

## 3. 확인한 사실

| # | 사실 | 출처 |
|---|---|---|
| F1 | nvm에 24.22.1(2026-10-21 설치, 공식 체크섬 일치)과 25.9.0이 있고, nvm default는 `node`(→25.9.0)다. | 실측 2026-10-26, 2026-10-21 사전 조사 기록 |
| F2 | `.profile`은 로그인 셸용이고, 설치된 nvm 버전 중 가장 높은 것을 PATH에 넣는다. 25가 설치돼 있는 한 이 블록은 25를 고른다. `.bashrc`는 비대화식 실행에서 곧바로 반환한다. 이미 실행 중인 세션의 자식 셸(`bash -c`)은 `.profile`을 읽지 않고 부모 PATH를 상속한다. | `.profile` 1–3·29–40행, `.bashrc` 5–9행 |
| F3 | live 프로세스는 PM2 fork 모드, interpreter는 Node 25의 절대 경로, 2026-10-18 이후 재시작 0회다. PM2 6.0.14 daemon과 logrotate도 25에서 돈다. stopped 앱 2개가 있다. live env에 `NODE_OPTIONS`는 없다(운영은 web storage가 켜진 25 기본 상태로 돈다). | `pm2 jlist` 2026-10-26 |
| F4 | PM2 daemon(PID 1352)은 `pm2-ubuntu.service`의 MainPID이고 unit은 active다. unit은 `Type=forking`, `PIDFile`, `Restart=on-failure`이며 PATH·ExecStart(`pm2 resurrect`)·ExecReload·ExecStop(`pm2 kill`)이 Node 25 경로에 고정돼 있다. `dump.pm2`는 2026-09-30 저장본이다. | unit 파일, `systemctl show` 2026-10-26 |
| F5 | live PM2 env에 앱 시작 당시 셸에서 상속된 Claude Code 세션 변수 이름들이 들어 있다. PM2는 restart 때 새 env를 기존 env에 병합하므로(`Utility.extend(proc.pm2_env.env, env)`), 정리된 셸에서 restart해도 기존 키는 지워지지 않는다. | `pm2 jlist` env 키 이름(값 미출력), PM2 `lib/God/ActionMethods.js:405` |
| F6 | Node 24 전역에는 npm·corepack만 있다. Node 25 전역: pm2 6.0.14, pnpm 10.33.0, typescript 7.0.2, typescript-language-server 6.0.2, opencode CLI, npm판 codex(PATH에서는 standalone codex가 먼저 잡힌다). | `ls` 2026-10-26, 2026-10-21 기록 |
| F7 | Codex MCP 서버 일부가 `node`/`npx`를 PATH로 실행한다. Claude Code·Codex·Antigravity 본체는 nvm과 무관한 실행 파일이다. GPT bridge unit은 자체 Node를 쓴다. | Codex 설정, `file` 2026-10-26, 검수 확인 |
| F8 | patcher 플러그인 sandbox는 Linux가 아니거나 Node major < 25이면 `plugin_sandbox_environment_unsupported`로 거절한다. live 트리의 같은 파일도 같은 조건을 갖는다. | `bgPluginSandbox.cjs:32` (origin/main `6737534`, live 트리) |
| F9 | Node 24의 `--permission`은 네트워크를 막지 않는다(`--allow-net`은 25.0.0에서 추가, 24.x backport 없음). sandbox 명령행 전체(systemd-run·prlimit·bwrap `--unshare-all`)를 24로 실행하면 bwrap의 네트워크 namespace가 막는다: 호스트 loopback `ECONNREFUSED`, 외부 IP `ENETUNREACH`, DNS `EAI_AGAIN`. 25·26에서는 같은 시도가 `ERR_ACCESS_DENIED`다. | 실측 2026-10-26(버전 조건만 지운 sandbox 사본), Node 25.0.0 release notes, v24 permissions 문서 |
| F10 | Node 문서는 권한 모델을 「seat belt」로 규정하고 악성 코드에 대한 보안 보장이 없다고 적는다. G1.6 설계도 namespace 격리를 주 경계, Node 권한 모델을 보조로 둔다. | nodejs v26.12.1 `doc/api/permissions.md:14-20`, patcher `docs/POCKETRISU-G1-6-PLUGIN-HOST-WIP.md:19-21` |
| F11 | 후보 gate는 25·24·26 모두 19/19 PASS이고 개수가 같다(client 2664/4, server 836/12, compat 123/5, repo 348/3, build 8033 modules). gate와 `run-probe.sh`는 web storage를 끄고 실행한다. | 실측 2026-10-26, patcher `6737534` |
| F12 | sandbox probe는 25에서 15/15, 24에서 0/15(F8의 거절), 26에서 1/15다. worker probe는 25에서 12/12, 24·26에서 2/12. host probe는 25에서 197/197이고 24·26에서는 600초 시한에 걸렸다. process probe는 합성 fixture가 없어 세 버전 모두 미측정이다. | 실측 2026-10-26 |
| F13 | sandbox probe의 fixture는 네트워크 차단을 `error.cause?.code === 'ERR_ACCESS_DENIED'`일 때만 성공으로 기록하고, probe는 `network: true`를 요구한다. 버전 조건만 낮추면 Node 24에서 namespace가 정상 차단해도 이 테스트는 실패한다. | `scripts/fixtures/bg-plugin-sandbox-worker.cjs:20-21`, `scripts/probe-bg-plugin-sandbox.cjs:31` |
| F14 | 네이티브 모듈 18개(11 패키지) 중 Node ABI에 묶인 것은 better-sqlite3 12.9.0이다. 24에서는 prebuild(ABI 137)가 설치되고, 18개 모두 로드되며 SQLite 쓰기·롤백이 정상이다. live의 기존 바이너리(ABI 141)는 24에서 로드되지 않는다. | 실측 2026-10-26, 2026-10-21 기록 |
| F15 | BG 번들은 `localStorage`를 자체 KV shim으로 항상 덮어쓰고, `sessionStorage`가 없을 때만 그 shim을 `sessionStorage`로도 쓴다. 24에는 전역 web storage가 없어 BG 번들의 `sessionStorage`가 25와 다른 객체가 된다. 검수에서 확인한 사용처(ID 생성 보관·화면 복귀·reload guard·CSS 복구 표식)에서 BG 회귀는 확인되지 않았고, plugin worker VM에는 sessionStorage가 없다. | live `server/node/bgOrchBundle.build.cjs:139-148`, `nodeStorage.ts:203-212`, `bgPluginWorker.cjs:944-949` |
| F16 | 공식 PocketRisu는 v1.10.0·v1.16.1 모두 Dockerfile `node:24-slim`, CI `node-version: 24`이고, 1.16.1 lockfile도 better-sqlite3 12.9.0이다. patcher CI는 Node 22로 돈다. | GitHub v1.10.0/v1.16.1 원문 2026-10-26, patcher `.github/workflows/ci.yml:22` |
| F17 | 최근 검증된 백업 세트: 2026-10-25 save tar와 bin 백업이 원격에 크기 일치로 있다. 디스크 사용률 48%. sudo는 비대화식으로 가능하다. | 2026-10-26 확인 |
| F18 | 오프라인 `pnpm install --frozen-lockfile --offline`은 24에서 store와 기존 prebuild 캐시로 성공한다(10.2초). Codex tester sandbox가 그 캐시를 읽을 수 있는지는 미확인이다. | 실측 2026-10-26 |
| F19 | 앱의 `db.cjs`는 writable open·PRAGMA·DDL을 수행하므로 백업용으로 import하면 안 된다. | live `server/node/db.cjs:22-44` |

## 4. 24와 26의 비교와 판단 규칙

판단 규칙: 업스트림이 배포하는 런타임을 따르고, 벗어나는 것은 실측된 보안·기능상의 필요가 있을 때만 한다.

- 보안 지원: 둘 다 받는다(24.22.1·26.12.1이 같은 보안 배포 묶음). 24는 2026-10-20부터 maintenance, 2028-04-30 종료. 26은 2026-10-28 LTS, 2029-04-30 종료.
- 실제 경계: 플러그인 네트워크 차단의 주 경계는 커널 namespace이고 24에서도 작동한다(F9). 26이 더 지키는 `--allow-net` 층은 보조층이다(F10).
- 26의 추가 비용: 현 worker가 26의 권한 모델에서 fd 3을 `net.Socket`으로 열지 못해 시작하지 못한다(F12, `bgPluginWorker.cjs:876`). better-sqlite3 12.9.0은 26을 지원하지 않는다(소스 빌드로만 동작). 업스트림이 26을 시험하지 않는다(F16).
- 결론: 24. 대가는 sandbox 네트워크 차단이 커널 namespace 한 겹이 되는 것과 2028-04 전에 한 번 더 옮겨야 하는 것이다.

재검토 트리거: 업스트림 PocketRisu의 Node 26 전환, Node 24 지원 종료 접근, namespace 격리 우회 사례 확인.

## 5. 단위

| ID | 제목 | 변경 대상 | 위험 |
|---|---|---|---|
| E1-1 | Allow the plugin sandbox on Node 24 | patcher `bgPluginSandbox.cjs` 버전 조건, sandbox fixture·probe의 네트워크 차단 판정, 관련 문서·release identity | risky (보안 경계) |
| E1-2 | Node 24 global tools | Node 24 전역 도구 설치(live 변경 없음) | normal |
| E1-3 | Isolated Node 24 qualification | 격리 사본 검증만 | — (검증) |
| E1-4 | Live cutover window | live 앱 interpreter·env·better-sqlite3 바이너리, PM2 daemon·dump, systemd unit | risky |
| E1-5 | New-shell default | `.profile`, nvm default alias | normal (전역 설정) |
| E1-6 | Records and environment facts | 계획·기록, gate 기준값, env-facts, Codex tester probe 재확인 | normal |

순서: E1-1 → E1-2 → E1-3 → E1-4 → E1-5 → E1-6. live의 sandbox 코드도 25 미만을 거절하므로(F8), E1-1을 포함한 patcher 버전이 live에 있어야 E1-4 뒤 BG 플러그인 host가 동작한다.

## 6. 단위별 내용

### E1-1 sandbox의 Node 24 허용 (patcher)

- 변경: `bgPluginSandbox.cjs:32`의 major 조건을 24 이상으로 낮춘다. 그 밖의 조건(Linux, main thread, runtime 범위)과 명령행(systemd-run·prlimit·bwrap·`--permission`)은 그대로 둔다.
- 시험 판정: sandbox fixture와 probe의 네트워크 차단 판정(F13)을 버전별로 나눈다. Node 25 이상은 지금처럼 `ERR_ACCESS_DENIED`를 요구한다. Node 24는 같은 목적지가 sandbox 밖에서는 연결된다는 대조군과, sandbox 안에서는 namespace에 따른 실패(loopback 연결 거부·외부 도달 불가·DNS 실패 등 구체 코드 목록)를 함께 확인한다. 임의의 네트워크 오류를 차단 성공으로 인정하지 않는다.
- 문서: G1.6 문서의 「Node 25 or later」와 sandbox 경계 설명을 F9·F10에 맞게 고친다. 지원표 한계: Node 24에서 플러그인 네트워크 차단은 namespace 한 겹이다.
- CI: patcher CI(Node 22, F16)는 installer 호환 범위로 그대로 두고, Node 24 검증은 후보 gate로 한다. 이 범위를 문서에 적는다.
- 흐름: risky 전체 흐름(Astra 계획 검수 → Argon 시나리오 → Codex 블라인드 테스트 → opus-implementer → Codex 코드 검수 → 후보 gate). gate·probe는 Node 24와 25 양쪽에서 돌린다.
- 수용 조건:
  - Node 24와 25에서 sandbox·worker·host probe가 25의 현재 결과(15/15, 12/12, 197/197)와 같은 수로 통과한다.
  - Node 24 sandbox 안에서 호스트 loopback·외부 IP·DNS가 모두 실패하고, 같은 목적지가 sandbox 밖에서는 연결된다.
  - Node 23 이하와 Linux 외 플랫폼은 그대로 거절된다.
  - 후보 gate 19/19, 개수는 F11과 같다.
- 시험 계약표 (전제 출처: F8 `bgPluginSandbox.cjs:32`, F13 fixture `:20-21`·probe `:31`, F9 실측. 모두 patcher `6737534` 기준):

| 수용 조건 | 입력 | 기존 상태 | 기대 결과 | 범위 밖 |
|---|---|---|---|---|
| 버전 조건 | `sandboxCommand(worker, 5000)`, Linux·main thread, Node major 24 / 23 / 25 | — | 24·25는 버전 조건에서 거절되지 않는다. 23은 `plugin_sandbox_environment_unsupported` | 버전 조건 뒤 단계(user manager·ldd·bwrap)의 성공 여부 |
| 플랫폼 조건 | Linux 외 플랫폼, Node 25 | — | `plugin_sandbox_environment_unsupported` | 다른 플랫폼에서의 실제 실행 |
| 명령행 불변 | Node 24와 25에서 만든 명령 | 현재 인자 목록 | executable·인자(systemd-run·prlimit·bwrap·`--permission`·`--allow-fs-read`·제한값)가 버전과 무관하게 같다 | unit 이름(무작위) |
| Node 25 이상 네트워크 판정 | sandbox 안 worker의 loopback 요청 | 현재 fixture·probe | `ERR_ACCESS_DENIED`일 때만 차단으로 인정(지금과 같다) | — |
| Node 24 네트워크 판정 | sandbox 안 worker에서 probe가 연 호스트 loopback listener, 외부 IP, DNS 이름 | sandbox 밖에서는 같은 listener 연결·외부 IP TCP 연결·DNS 해석이 성공(대조군) | 안: loopback `ECONNREFUSED`, 외부 IP `ENETUNREACH`, DNS `EAI_AGAIN`. 이 목록 밖의 오류 코드나 성공은 차단 실패 | 대조군이 실패한 환경에서의 판정(대조군 실패는 probe 실패로 보고) |
| 나머지 sandbox 성질 | 기존 probe 15개 | Node 25에서 15/15 | Node 24·25 모두 같은 단언으로 통과(read·write·spawn·worker `ERR_ACCESS_DENIED`, env 키 `['PWD']`, 메모리·시한·속도 제한, parent death) | — |

### E1-2 Node 24 전역 도구

- Node 24 전역에 Node 25와 같은 버전을 설치한다: pm2 6.0.14, pnpm 10.33.0, typescript 7.0.2, typescript-language-server 6.0.2. npm판 codex는 설치하지 않는다(standalone 사용). opencode CLI는 사용처를 확인한 뒤 정한다.
- 이 단계는 live 프로세스·PM2 daemon을 건드리지 않는다. Node 24의 pm2 client를 실행하면 같은 `PM2_HOME`의 기존 daemon에 붙으므로, E1-4 전에는 Node 24의 `pm2`를 실행하지 않는다.

### E1-3 격리 검증

validation-runner가 세션 scratchpad 안에서만 수행한다.

1. **검증 대상 확정:** E1-4에서 live에 둘 patcher identity(commit, release identity, pack 목록)를 먼저 정한다. live 적용이 E1-1보다 넓은 범위(아직 live에 없는 앞선 후보 단위)를 포함하면, 그 전체 조립 결과를 검증 대상으로 삼는다. sandbox 변경만 넣은 사본으로 대신하지 않는다.
2. **ABI별 독립 사본:** 같은 소스와 같은 초기 합성 save에서 Node 24용(better-sqlite3 ABI 137)과 Node 25용(ABI 141) 사본을 따로 만든다. 한 사본의 바이너리를 바꿔 가며 쓰지 않고, 실행마다 합성 save를 초기 상태로 되돌린다. 각 사본에서 네이티브 모듈 18개 로드와 SQLite 쓰기·롤백을 확인한다.
3. **운영과 같은 조건의 기동:** live와 같은 `NODE_OPTIONS`(현재 없음, F3)로, 각 사본 서버를 loopback의 빈 포트에서 띄운다. 시작 시 마이그레이션·복구를 마치고 listen하는지, `/` 200, 인증 API, 일반 채팅 API, WebSocket·SSE 경로, BG 합성 생성(가짜 provider) 1회, BG 플러그인 host로 합성 플러그인 1개 실행을 확인한다. 24와 25의 결과를 비교한다.
4. **F15 sessionStorage:** 3번의 24·25 실행에서 BG 경로가 쓰는 sessionStorage 값과 결과를 비교한다.
5. **live DB 사본 무결성:** 앱 코드(`db.cjs`, F19)를 쓰지 않고 별도 스크립트로 live DB를 읽기 전용으로 열어, better-sqlite3 `backup()`으로 scratchpad 안의 별도 파일에 사본을 만든다. 시간 제한과 실패 시 중단을 둔다. 사본만 Node 24로 열어 `quick_check`를 확인하고, 검증 뒤 사본을 지운다.
6. **창 길이:** stop부터 listen까지 걸린 시간을 재서 E1-4 창의 길이 근거로 쓴다.

### E1-4 live 전환 창

**사전 확인(읽기 전용):**
1. 최근 검증된 백업 세트가 있다(F17 갱신).
2. 진행 중인 생성이 없다. 진행 중이면 취소하지 않고 끝날 때까지 기다린다.
3. live의 patcher 상태를 읽는다. E1-1을 포함한 patcher 버전이 없으면 E1-3에서 검증한 그 버전의 live 적용을 먼저 진행한다(적용 범위를 목록으로 보고하고 확인받는다). 또는 live의 BG 플러그인 host가 꺼져 있음을 확인하고, E1-4 뒤 host를 켜기 전에 E1-1이 적용돼야 한다는 조건을 기록한다.
4. 복구점: 현재 상태로 `pm2 save`를 한 번 실행해 dump를 최신으로 만든 뒤(9월 dump는 복구점이 아니다), `dump.pm2`, `module_conf.json`, unit 파일, better-sqlite3 바이너리, `.profile`, nvm default alias 값을 scratchpad에 백업하고 SHA-256을 남긴다.
5. 등록 설정 기록: 앱 등록을 다시 만들 때 필요한 값을 `pm2 jlist`에서 기록한다. script·cwd·args·interpreter args·exec mode·instance 설정, out/error/combined log 경로·merge_logs·timestamp·pid 파일 설정, autorestart·watch·restart delay/limit·memory limit·kill/ready timeout·cron·namespace·uid/gid. 앱에 필요한 env 값은 그 값의 원래 출처에서 확인하고(로그에 값을 남기지 않는다), 상속된 세션 변수는 의도적으로 뺀다. PM2 숫자 ID는 바뀔 수 있으며 보존을 약속하지 않는다.
6. systemd 상태: `pm2-ubuntu.service`의 ActiveState·MainPID·ControlGroup과 daemon PID 일치(F4).

**리허설:** 아래 창 안의 순서와 rollback 두 경로 전체를 임시 `PM2_HOME`과 임시 이름의 시험용 systemd unit에서 같은 구성(online 앱 1개, stopped 앱 2개, logrotate, 같은 unit 형식)으로 실행해 명령을 확정한다. 확인 항목: unit이 새 daemon을 MainPID로 관리하는지, stopped 앱이 stopped로 남는지, logrotate가 Node 24로 재기동되고 설정이 유지되는지, 다시 만든 앱 등록이 5번의 값과 같고 상속 세션 변수 키가 없는지, 생성된 unit의 PATH가 Node 24 경로로 시작하는지. `pm2 startup`은 unit을 쓰고 enable만 하며 daemon을 시작·정지하거나 dump를 쓰지 않는다(PM2 `lib/API/Startup.js:243-251,366-388`). PM2 실행 파일의 `#!/usr/bin/env node`가 25를 잡지 않도록, 호출할 때 PATH의 맨 앞을 Node 24로 고정하고 생성된 unit의 PATH를 읽어 확인한다. 리허설용 unit과 디렉터리는 끝나면 지운다.

**창 안의 순서:** 앱은 마지막 단계에서 처음으로 다시 접근 가능해진다. 중간에 앱을 시작하지 않는다.
1. `pm2 stop risuai-nodeonly`. 프로세스 종료를 PID로 확인한다.
2. live save 디렉터리를 정지 상태로 복사해 로컬 복구점을 만든다(허용 경로 `backups/` 아래).
3. better-sqlite3 바이너리를 E1-3에서 검증한 Node 24용으로 교체한다(기존 파일은 이름을 바꿔 보존).
4. `pm2 delete risuai-nodeonly` → `pm2 save`. dump에는 stopped 앱 2개만 남는다.
5. daemon 이전은 systemd를 통해 한다: `systemctl stop pm2-ubuntu`(daemon 종료) → daemon PID 소멸 확인 → PATH 맨 앞을 Node 24로 고정한 Node 24의 pm2로 unit 재생성(`pm2 startup systemd -u ubuntu --hp <home>`, sudo) → 생성된 unit의 PATH·ExecStart 확인 → `systemctl daemon-reload` → `systemctl start pm2-ubuntu`(Node 24 daemon이 stopped 앱과 logrotate를 되살린다). systemd 밖에서 `pm2 update`·`pm2 kill`로 daemon을 바꾸지 않는다(F4의 `Restart=on-failure`와 경합할 수 있다).
6. 앱 등록을 다시 만든다: 사전 확인 5에서 기록한 값과 필요한 env만 가진 정리된 환경(`env -i` 기반, PATH는 Node 24 우선)에서 같은 이름·cwd·스크립트·옵션으로 Node 24 interpreter를 지정해 `pm2 start`한다. PM2 restart는 env를 병합하므로(F5) restart가 아니라 새 등록으로 만든다. 이때 앱이 처음으로 다시 접근 가능해진다. 이어서 `pm2 save`.
7. 독립 readback:
   - unit active, MainPID가 새 daemon PID와 같고 ControlGroup이 unit 아래다.
   - daemon·logrotate·앱의 `/proc/<pid>/exe`가 Node 24다.
   - stopped 앱 2개는 stopped다.
   - 앱 online·재시작 0, `/` 200, 제공 JS hash 일치, DB `quick_check=ok`, error log 증가 0, 앱 env에 상속 세션 변수 키가 없다.
   - BG 합성 확인(가능한 범위).

**rollback:** daemon이 정상이든 멈췄거나 실패했든 같은 오프라인 경로를 쓴다. daemon이 없을 때는 일반 `pm2` 명령을 실행하지 않는다(PM2 client는 연결할 daemon이 없으면 새 daemon을 띄우므로 systemd 밖의 daemon이 생긴다, PM2 `lib/Client.js:104`). `pm2 save`에 의존하지 않는다(`save`는 현재 등록만 저장한다).
1. 앱이 떠 있으면 새 요청과 진행 중인 작업을 확인하고(진행 중이면 기다린다), `systemctl stop pm2-ubuntu`로 daemon과 앱을 함께 멈춘다. daemon·앱 PID 소멸을 확인한다.
2. 오프라인 복원: 사전 확인 4의 dump(Node 25 interpreter 경로가 들어 있는 전환 직전 등록), unit 파일, Node 25용 better-sqlite3 바이너리를 복원하고 SHA-256을 대조한다. unit만 되돌려서는 dump에 기록된 Node 24 interpreter 경로가 바뀌지 않으므로 dump도 반드시 되돌린다(PM2 `lib/God/ForkMode.js:43-47`). `module_conf.json`과 module 파일은 바뀐 경우에만 복원한다.
3. `systemctl daemon-reload` → `systemctl start pm2-ubuntu`(Node 25 daemon이 전환 직전 dump를 되살린다).
4. E1-5까지 진행했다면 `.profile`과 nvm default alias를 백업 값으로 복원한다.
5. readback: unit MainPID, 각 프로세스의 Node 25 실행 파일, 앱 online, stopped 앱, logrotate, `/` 200, DB `quick_check=ok`.

데이터: 같은 앱 코드에서 런타임과 네이티브 ABI만 되돌리는 rollback이면 better-sqlite3·SQLite 버전이 같으므로 데이터 복원은 필요하지 않다. 사전 확인 3에서 patcher 버전을 함께 live에 적용했다면, 그 버전의 startup migration·복구·쓰기 호환성은 이 근거로 보장되지 않는다. 그 경우 rollback은 patcher의 revert 절차와 창 2번의 로컬 복구점을 기준으로 따로 정한다. 로컬 복구점은 이상이 없을 때 기존 백업 정리 기준으로 정리한다.

### E1-5 새 셸 기본값

- `nvm alias default 24.22.1`.
- `.profile`의 「가장 높은 버전 선택」 블록을 nvm default alias를 읽는 방식으로 바꾼다. alias가 가리키는 디렉터리가 없을 때만 지금의 방식으로 돌아간다.
- 실행 중인 Claude/Codex 세션·MCP 프로세스는 건드리지 않는다.
- 확인은 실행 방식별로 나눈다(F2). 각 경우 `node -v`와 `command -v node`를 본다.
  - 새 로그인 셸(`bash -lc`, 새 SSH 접속)과 그 아래에서 연 셸: 24.
  - 이미 실행 중인 세션에서 연 셸(비대화식 자식 셸과 비로그인 대화식 셸 모두): 25로 남는 것이 정상이다. 비대화식 셸은 부모 PATH를 상속하고, 대화식 셸의 nvm은 이미 선택된 버전이 있으면 default 대신 그 버전을 유지한다(`.bashrc:119-120`, `nvm.sh:4570-4583`). 이 세션들이 끝나면 새 세션부터 24가 된다.
  - cron: crontab의 작업은 Node를 쓰지 않는다(확인 대상 목록과 근거를 기록한다). systemd unit은 E1-4에서 따로 옮긴다. GPT bridge는 대상이 아니다(F7).

### E1-6 기록과 환경 사실

- gate 기준값을 Node 24 기준으로 다시 잰다(F11과 비교).
- Codex tester 권한 profile probe를 Node 24에서 다시 실행하고, 오프라인 `pnpm install`이 sandbox 안에서 되는지 확인한다(F18).
- `docs/records/pocketrisu-env-facts.md`(local)의 Node 관련 항목을 갱신한다.
- 정본 머리말과 이 계획의 결과를 기록한다.

## 7. 그대로 유지해야 하는 동작

- 사용자 데이터·인증·접근 주소·기존 라우트.
- BG 생성·대기열·결과 전달·플러그인 host 동작(Node 25에서의 결과와 같은 수의 probe 통과).
- Node 25 이상에서 sandbox의 `--permission` 네트워크 차단과 그 시험 판정.
- stopped PM2 앱은 stopped로 남고, logrotate 설정은 유지된다. GPT bridge처럼 nvm 밖의 런타임은 대상이 아니다.
- 실행 중인 Claude/Codex 세션과 MCP 연결은 강제로 옮기지 않는다.

## 8. 미확인과 측정 계획

- process probe: 합성 fixture가 없다. E1-3에서 fixture를 만들 수 있으면 24·25에서 돌리고, 아니면 미측정으로 남긴다.
- host probe의 Node 24 전체 결과: E1-1 검증에서 측정한다.
- PM2·systemd 전환 명령의 정확한 동작: E1-4 리허설에서 측정한다.
- live의 patcher 상태와 BG 플러그인 host의 on/off: E1-4 사전 확인 3에서 읽는다.

## 9. 계획 검수 기록

**Astra 1회차 (2026-10-26, `gpt-6-astra`, read-only):** 지적 7건을 모두 코드와 대조해 반영했다.
1. sandbox fixture·probe가 Node 25의 `ERR_ACCESS_DENIED`에만 차단 성공을 인정한다(F13) → E1-1 변경 범위와 수용 조건에 버전별 판정을 넣었다.
2. 같은 사본을 Node 25 대조군으로 쓰면 ABI가 맞지 않는다 → E1-3을 ABI별 독립 사본·합성 save 초기화로 바꿨다.
3. PM2 restart는 env를 병합하므로 정리된 셸만으로 상속 변수가 지워지지 않는다(F5) → E1-4를 등록 재생성과 env 키 readback으로 바꿨다.
4. 임시 `PM2_HOME` 리허설만으로는 systemd 관리 관계를 확인할 수 없다 → 사전 확인 5, 시험용 unit 리허설, systemd를 통한 daemon 이전, MainPID·cgroup readback을 넣었다. 검수 뒤 직접 확인으로 daemon이 unit의 MainPID이고 `Restart=on-failure`임을 확인해, systemd 밖의 `pm2 update`를 쓰지 않도록 했다(F4).
5. rollback에 정지·종료 확인과 셸 설정 복원이 빠졌다 → rollback 순서를 다시 쓰고 `.profile`·alias를 복구점에 넣었다.
6. 검증한 코드와 배포할 코드가 같아야 하고, 데이터 무복원 근거는 같은 앱 코드에 한정된다 → E1-3 1번과 E1-4 데이터 문단을 고쳤다.
7. 「새 비대화식 셸은 24」는 실행 방식별로 나눠야 한다(F2) → E1-5 확인을 네 경우로 나눴다.

**Astra 2회차 (2026-10-26):** 1회차 1·2·3·4·6번은 닫힘, 5·7번은 일부만 닫힘으로 판정했다. 새 지적 3건을 PM2·nvm 소스와 대조해 반영했다.
1. 고친 순서는 앱을 systemd 이전 전에 시작했다가 daemon 정지로 다시 멈춰, 그 사이 요청이 보호되지 않는다(PM2 `lib/API.js:638`, live `server.cjs:7899-7905`) → 앱 등록을 지운 상태로 daemon을 옮기고, 앱은 마지막 단계에서 처음 시작하도록 바꿨다.
2. rollback이 정상 daemon과 온전한 등록을 전제한다. daemon이 없을 때 `pm2` 명령은 새 daemon을 띄우고, `save`는 현재 등록만 저장한다(PM2 `lib/binaries/CLI.js:216-230`, `lib/Client.js:104`, `lib/API/Startup.js:504-510`) → 전환 직전 dump를 복구점으로 만들고, systemd 정지 뒤 dump·unit·바이너리를 오프라인으로 복원하는 단일 경로로 바꿨다.
3. 실행 중인 세션에서 연 대화식 셸은 nvm이 기존 버전을 유지한다(`nvm.sh:4570-4583`) → E1-5 확인 기준을 고쳤다.
등록 재생성에 필요한 설정 목록(사전 확인 5), PM2 숫자 ID 비보존, `pm2 startup`의 동작과 PATH 고정, logrotate가 dump가 아닌 `module_conf.json`으로 되살아난다는 점도 반영했다.

검수의 추가 판단도 반영했다: Node 24에서 sandbox·worker·host·session이 쓰는 다른 API에서 Node 25 전용 의존은 찾지 못했다(버전 조건 해제 뒤 전체 통과는 E1-1에서 측정). 운영과 같은 `NODE_OPTIONS`로 비교한다(E1-3 3번). live DB 사본은 `db.cjs`를 쓰지 않는 읽기 전용 `backup()`으로 만든다(F19). patcher CI의 Node 22 범위를 문서에 적는다.
