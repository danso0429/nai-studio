# SDStudio Remote

[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/License-PolyForm_NC_1.0.0-blue.svg)](https://polyformproject.org/licenses/noncommercial/1.0.0)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-Linux-FCC624?logo=linux&logoColor=black)](https://ubuntu.com/)

[SDStudio](https://github.com/Dd154663/SDStudio) (Electron 데스크톱 앱)를 **웹 서버**로 이식한 프로젝트입니다.
자기 서버에 한 번 설치하면 PC·태블릿·스마트폰 어디서든 브라우저로 접속해 NovelAI 이미지 생성을 사용할 수 있어요. **이미지 생성은 서버에서 처리되니까 브라우저나 폰을 닫아도 대량 생성이 멈추지 않아요.**

> 이 프로젝트는 [Dd154663/SDStudio](https://github.com/Dd154663/SDStudio)의 fork이며, 원작 [sunho/SDStudio](https://github.com/sunho/SDStudio)에서 파생된 프론트엔드를 사용합니다.

> ### 🤖 막히면 LLM에게 물어보세요
>
> 이 프로젝트는 **Claude + Claude Code의 100% 도움으로 제작**됐어요. 설치/사용 중 막히는 부분이 있으면 Claude·ChatGPT·Gemini 같은 LLM에게 **에러 메시지·명령어·이 README를 그대로 붙여넣고** 물어보면 거의 다 풀려요. 코딩 경험 없어도 LLM 안내 따라가면 충분히 해결됩니다.

![메인 화면](https://raw.githubusercontent.com/Dd154663/SDStudio/main/images/img1.png)

---

## 누가 쓰면 좋아요?

- 본인 **NovelAI 계정 (Opus 티어 필수)** 가지고 있고
- 모바일/태블릿에서도 SDStudio 쓰고 싶고
- 폰 화면 꺼두고 잠들어도 N장 생성이 진행됐으면 하고
- 큐가 어떻게 진행되고 있는지 다른 페이지에서 모니터링하고 싶고
- 직접 서버에 설치할 의지가 있는 사람

코딩 처음이어도 가이드 따라하면 30분~1시간 안에 동작합니다. 막히면 LLM에게 물어보세요.

---

## 목차

- [주요 기능](#주요-기능)
- [SDStudio PC 버전과의 차이점](#sdstudio-pc-버전과의-차이점)
- [설치 (뉴비 친화 단계별)](#설치-뉴비-친화-단계별)
- [사용 방법](#사용-방법)
- [queue.html — 큐 진행 상황 페이지](#queuehtml--큐-진행-상황-페이지)
- [업데이트 방법](#업데이트-방법)
- [환경변수](#환경변수)
- [고급 설정 (선택)](#고급-설정-선택)
- [보안 / 프라이버시](#보안--프라이버시)
- [자주 묻는 질문](#자주-묻는-질문)
- [변경 이력](#변경-이력)
- [라이센스 / 크레딧](#라이센스--크레딧)

---

## 주요 기능

**Google Drive 연결은 선택사항이에요.** 안 해도 NAI 이미지 생성, 큐, 내보내기 다 됩니다. Drive 설정 안 하면 백업/동기화 기능만 비활성화돼요.

> 서버가 `rclone` 설치 + `RCLONE_REMOTE` 매칭 여부를 자동 감지해요. 미설정 시 Drive 관련 background 작업 (export 후 자동 업로드 / 재시도 큐 / 30초 폴링) 모두 자동 skip → 모바일 데이터·배터리 낭비, retry queue 누적 0건.

### 🎨 SDStudio PC 버전의 핵심 기능 그대로

- **씬별 이미지 생성** — 프리셋(상위/하위/네거티브 프롬프트) + 씬(중간 프롬프트) 조합으로 캐릭터 에셋 대량 생성
- **이미지 월드컵** — 생성된 이미지를 토너먼트로 선별
- **인페인팅** — 마스크로 일부분만 다시 생성
- **이미지 변형 (img2img)** — 기존 이미지를 베이스로 다른 버전 생성
- **배경 제거** — 클릭 한 번으로 알파 채널 마스크
- **태그 자동완성** — Danbooru 태그 데이터베이스 검색
- **프롬프트 조각** — 자주 쓰는 프롬프트 블록 저장/조립
- **NAI v4 / v4.5 완전 지원** — 멀티 캐릭터 프롬프트, 캐릭터 레퍼런스, 바이브 트랜스퍼
- **🆕 캐릭터 프리셋 v2** (v1.6.0, SDStudio v4.8.0 흡수 + v1.7.3에서 v4.8.1/v4.8.2 통합) — 카드 그리드 목록 + 중앙 모달 편집 + 대표 이미지(폴백 체인) + 상세 슬라이더(IS/RS, Strength/Fidelity, 타입/활성화 토글). **JSON Import/Export** (바이브/레퍼런스/대표이미지 base64 포함) + **순차 생성** (프리셋 N × 씬 M 자동 순회, 일시정지/재개/취소). 프리셋 적용 중 vibe/ref 개별 삭제 잠금(`presetLocked`) 안전장치. **v1.7.3**: 삭제 시 적용 중이면 auto-clear, 프로젝트 로드 시 orphan cleanup, 프리셋 교체 시 옛 vibes/refs residue 잔류 fix, 모바일에서 프리셋 적용 중 사람 버튼 클릭 시 [해제]/[관리] 선택 dialog.

### 🌐 웹/모바일 전용 추가 기능

- **🖥️ 서버 큐 백그라운드 처리** — 브라우저 닫아도, 폰 꺼도 서버가 계속 처리. 다시 열면 진행 상태 자동 복원
- **📱 어디서든 접속** — Tailscale로 PC·모바일에서 동일 서버에 접근
- **🔄 자동 업데이트** (v1.7.0+) — 새 버전 출시 시 우측 상단 / 모바일 알약에 표시. **NAI 로그인 상태면 UI 한 클릭**으로 `git pull → npm install → vite build → pm2 restart` 자동 진행. SSH 접속 불필요, iPhone에서도 가능. SSH `./update.sh` 대체 가능
- **🔧 업스트림 SDStudio 새 release 알림** (v1.7.3) — fork 자체 update orange 펄스(🔄)와 별개로, 업스트림 [Dd154663/SDStudio](https://github.com/Dd154663/SDStudio)에 새 release 올라오면 indigo 펄스(🔧)로 표시. 클릭 시 upstream release notes 새 탭. 본 fork이 upstream patch 따라잡을 시기 파악용
- **📊 상단 진행 알약 + 큐 트리** — 진행률 + 예상 남은 시간 표시. 클릭 시 폴더 → 프로젝트 → 씬 3단 트리(default 다 접힘) + 처리 중 항목 펄스 + **⭐ 우선순위 큐**(씬/프로젝트 단위 toggle, 큐 앞으로 정렬) + 카운터 snapshot(분모 고정, 완료 후 자연 사라짐)
- **🎚️ 개수 컨트롤** — ◀▶ 버튼으로 ±1, 텍스트 입력도 가능
- **📁 프로젝트 폴더 분류** — 폴더로 프로젝트 카테고리화 (depth=1)
- **🗂️ 내보내기 프리셋** — 자주 쓰는 내보내기 설정 (전체/즐겨찾기, 형식, 크기, 구분자) 저장. 한 번 설정하고 다이얼로그 없이 즉시 내보내기. 최대 3개
- **📂 폴더 전체 내보내기** — 폴더 안 모든 프로젝트에 동일 프리셋 적용해서 1개 zip으로 묶음
- **🗃️ 프로젝트 다중 내보내기 (project.json)** (v1.7.3) — 트리에서 N개 체크박스로 선택, 폴더 체크박스 3-state(전체/일부 indeterminate). 클릭 즉시 picker 닫히고 **백그라운드** 진행 → 메인 화면 progress dialog `X/N` 카운터로 추적. Drive 가용시 cheap ACK 4개 병렬로 큐 등록(서버가 자체 직렬화), 미가용시 브라우저 다운로드 직렬(mobile 다중 차단 회피). 내보내기 중 그 프로젝트 삭제/이름변경 시도 시 **소프트 락**으로 안내 차단
- **💾 폴더 전체 백업/복원** — 폴더 N 프로젝트의 project.json + outs + inpaints + vibes 전부를 1개 tar로 묶음 + `folder-backup.json` 마커. Drive 가용시 `backups/` 폴더로 자동 분류. 폴더 단위 import도 지원 (이름 충돌 auto-suffix, 폴더 없으면 자동 생성)
- **⬇️ 단일 이미지 다운로드 → Drive 직행** — 옵션/다이얼로그 없이 한 번 클릭. Drive 가용시 `exports/`에 쓰고 sync 큐 등록 → 자동 업로드. 미가용시 브라우저 즉시 다운로드
- **☁️ Google Drive 자동 동기화 (선택)** — rclone 설정하면 내보내기 결과를 즉시 업로드. 실패 시 6회 자동 재시도(exponential backoff). 좌측 하단 위젯에서 진행 확인. **v1.7.3 위젯 개선**: 각 row의 [재시도] 버튼이 즉시 처리(reset+rclone 호출) + 누른 row만 펄스/spinner. failed 뿐 아니라 pending entry도 [재시도]로 스케줄 무시하고 즉시 시도 가능
- **🚀 Drive 병렬 업로드** — 씬 이름 / 프로젝트 / 이미지 내보내기 동시 처리. 큐 한도 5000 + LRU eviction으로 안전
- **🔍 태그 자동완성 split 레이아웃** — 모바일 세로 = 상하 분할, 가로/PC = 좌우 분할
- **⏸️ 큐 일시정지/재개** — 진행 중 stop 누르면 in-flight 후 일시정지. run 누르면 재개. 상태는 disk에 영속화 (서버 재시작해도 큐 유지)
- **📈 /queue.html 진행 페이지** — 별도 페이지에서 큐 상태, NAI 에러 history, Drive 업로드, 최근 처리 시간 sparkline 표시. 완료 탭(프로젝트별 batch + 4시간 retention), 전체정리 미리보기, 큐 통계 2시간 12-bucket 누적
- **🔁 씬 일괄 임포트** — JSON 스키마로 N개 씬을 한번에 추가. dryRun + overwrite/skip 모드
- **🧩 씬 통합 (대량 작업)** — 여러 씬을 하나로 합치면서 조합 슬롯 dedup + 이미지 모음
- **➖ 씬/조합 단위 네거티브** — 프리셋 전체뿐 아니라 씬(`scene.uc`)과 조합 슬롯(`PromptPiece.uc`)에 개별 네거티브
- **🗑️ 프로젝트 영구 삭제** — 로컬 5폴더 + Drive 5폴더 병렬 purge. 백그라운드 처리 + WS 진행 토스트
- **📥 다중 프로젝트 임포트** — JSON ≥2개 드래그드롭 / iOS 파일 picker 다중 선택 시 3-way 선택(전부 새 / 일부 머지 / 전부 머지) + 페이지당 4개 이름 입력 UI (원본 이름 라벨 + 빈칸/중복 검증)
- **🛡️ 네트워크 회복성** — 일시 단절 시 자동 재시도(`ResourceSyncService`), 캐시 fallback, fetch timeout, 클릭 차단 가드

---

## SDStudio PC 버전과의 차이점

> 기준: SDStudio v4.8.2 (v1.7.3 시점). 현재 Remote 버전은 `version.json` 참조 (변경 로그는 `CHANGELOG.md`).

| 항목 | SDStudio PC (v4.8.2) | SDStudio Remote |
| --- | --- | --- |
| **실행 방식** | Electron 데스크톱 앱 | Node.js 서버 + 브라우저 접속 |
| **설치 위치** | 사용자 PC | 자기 서버 (Linux 권장) |
| **이미지 저장** | 사용자 PC 로컬 디스크 | 서버 디스크 (`data/outs/`) |
| **이미지 큐** | 브라우저 닫으면 중단 | 서버 측 큐, 브라우저 닫아도 계속. 폰 닫아도 진행, 다시 열면 자동 동기화 |
| **여러 기기 접속** | 불가 (PC 1대) | PC + 모바일 동시 접속 가능 |
| **다중 사용자** | 불가 | 단일 사용자 가정 (인증 미구현, 사설망 전제) |
| **파일 시스템 접근** | 무제한 (네이티브) | API 통한 sandbox (`data/` 하위만) |
| **NAI 토큰 저장** | OS keychain 또는 설정 | `data/TOKEN.txt` 평문 |
| **업데이트 방식** | 앱이 자동 감지 + 클릭 | 앱이 자동 감지 + UI 한 클릭 (NAI 로그인 상태면 자동 인증 → progress → 새로고침, v1.7.0+) / SSH `./update.sh` 대체 가능 |
| **태그 DB (Danbooru)** | 앱 내장 | `data/db.csv` 별도 배치 (선택) |
| **백업** | 사용자가 폴더 복사 | 자동 동기화 (선택, rclone) |
| **AVIF 최적화** | 미지원 | 지원 (모바일 데이터 절약) |
| **이미지 썸네일 캐시** | 매번 재생성 | 서버에서 prewarm (200/400/500px) |
| **프로젝트 폴더 분류** | 평면 (폴더 없음) | depth=1 폴더 지원 |
| **Drive 업로드 실패 처리** | 해당 없음 | exponential backoff 자동 재시도 + 좌측 하단 위젯 + row별 [재시도] 즉시 처리/시각화 (v1.7.3) |
| **내보내기 다이얼로그 chain** | 매번 옵션 6개 선택 | 프리셋 저장 후 한 번 클릭으로 즉시 (다이얼로그 일체화) + `prefix_ask` 캐릭터 이름 직접 입력 옵션 (v4.8.2 흡수, v1.7.3) |
| **프로젝트 다중 내보내기 (.json)** | 1개씩만 | 트리 picker로 N개 동시, 백그라운드 + 4-병렬 큐 등록, 진행 중 delete/rename 소프트 락 (v1.7.3) |
| **업스트림 SDStudio 알림** | 해당 없음 | fork update orange 펄스(🔄)와 별개로 업스트림 indigo 펄스(🔧) (v1.7.3) |
| **진행 상황 표시** | 모달 다이얼로그 | 상단 진행 알약 + 다중 progress |
| **큐 영속화** | 미지원 | 서버 재시작에도 보존 (`data/.queue_state.json`) |
| **폴더 전체 백업/복원** | 미지원 (수동 폴더 복사) | 1 tar로 묶음 + Drive `backups/` 자동 분류 + 폴더 단위 복원 (이름 충돌 auto-suffix) |
| **이미지 다운로드** | OS 다이얼로그 → 폴더 선택 | "다운로드" 한 번 클릭 → Drive 자동 (미사용시 브라우저 즉시) |
| **씬 자동 갱신** | 앱 자체 처리 | 큐 진행 중 disk polling으로 자동 갱신 (이벤트 누락 안전망) |
| **커스텀 해상도 입력** | 모달 1개 | 한 폼에 width/height 동시 입력 + 64배수 자동 round-up |
| **로그인 피드백** | 모달 | sticky 토스트 (시도/성공/실패 자동 dismiss) |

### 미이식 / 미지원 기능

| 기능 | 상태 | 이유 |
| --- | --- | --- |
| Windows 네이티브 단축키 | 미지원 | 브라우저 기반 |
| 클립보드 이미지 직접 붙여넣기 | 부분 지원 | 브라우저 권한 의존 |
| 다중 사용자 / 인증 | 미지원 | 본인 서버 + Tailscale 사설망 가정 |

---

## 설치 (뉴비 친화 단계별)

서버에 한 번 설치하면 그 다음부터는 PC/모바일 브라우저로 접속해서 사용해요. 코딩 모르는 사람도 가이드 명령어 그대로 복붙하면 동작해야 해요. 막히는 부분 있으면 [Issues](https://github.com/danso0429/nai-studio/issues)에 알려주세요.

### 사전 준비

- **리눅스 서버** (Ubuntu 22.04+ 추천. ARM64 OK)
  - 무료로 받으려면 **Oracle Cloud Always Free**의 ARM Ampere A1 추천 — 4 vCPU + 24GB RAM 무료 (이 프로젝트가 실제로 동작 중인 환경)
  - 한국어 가이드: [아카라이브 오라클 가이드](https://arca.live/b/characterai/137016430) + [할당량 부족 시 PAYG 업그레이드](https://arca.live/b/characterai/137100634)
  - **본 프로젝트와 다른 부분 (주의)**:
    - 가이드의 **포트 6001**은 노드리스용. 본 프로젝트는 기본 **6247** — 그런데 **인터넷에서 직접 접근할 게 아니라면 보안 규칙에 6247도 안 여는 게 안전** (Tailscale로만 접근하면 외부 노출 0)
    - 가이드의 4단계(RisuAI 설치) + 6단계(https 인증서)는 **SKIP**. 본 README의 [설치 단계](#설치-뉴비-친화-단계별)를 따라하세요
    - **80/443 포트 인터넷 노출은 SDStudio Remote에 불필요해요.** 가이드가 80/443을 0.0.0.0/0으로 열라고 하는 건 RisuAI가 그 포트에서 자체 HTTPS 서버를 띄우기 때문. SDStudio Remote는 Tailscale serve가 *tailnet 내부 IP(100.x.x.x)에만* 443 바인딩 → Oracle 보안 그룹 외부 80/443은 빈 포트라 의미 없고, 닫는 게 공격 표면 최소화. (Tailscale 자체는 outbound UDP만 쓰므로 inbound 룰 필요 X)
    - **결론**: SDStudio Remote만 운영하면 Oracle 수신 규칙에 **22(SSH)만 임시로**, Tailscale 동작 확인 후 22도 닫기. 80/443/6247 다 닫아도 됨.
    - 사양 추천: **2 CPU / 12 GB RAM** 또는 그 이상 (SDStudio Remote도 동일)
    - HTTPS는 본 프로젝트에서 **Tailscale serve로 자동 처리** (Let's Encrypt 불필요). 가이드의 self-signed 인증서는 안 만들어도 됨
- **NovelAI 계정** + Persistent API Token (받는 방법은 아래 step 3에)
- **선택**: Tailscale 계정 (외부 접속용, 무료)

### Step 1. Node.js 설치

서버 SSH 접속한 후 실행:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential git
node --version    # v20.x.x 떠야 함
```

> Ubuntu/Debian 기준이에요. 다른 OS는 [nodejs.org](https://nodejs.org/) 참고하세요.

### Step 2. SDStudio Remote 다운로드 + 빌드

다음 2줄만 붙여넣으세요. `setup.sh`가 자동으로 .env.local 준비 + 의존성 설치 + 빌드를 다 해줘요 (총 3~5분).

```bash
cd ~ && git clone https://github.com/danso0429/nai-studio.git && cd nai-studio
./setup.sh
```

다른 경로/포트 원하면 `setup.sh` 실행 전에 `nano .env.local` 편집(기본값 `PORT=6247`, `URL_PREFIX=/studio`), 또는 실행 후 편집하고 `./setup.sh` 다시 돌리면 돼요. 재실행 안전(기존 .env.local 보존).

<details>
<summary>setup.sh 안 쓰고 수동으로 단계별 보고 싶으면 여기 펼치기</summary>

```bash
cd ~ && git clone https://github.com/danso0429/nai-studio.git && cd nai-studio
cp .env.example .env.local
npm install
(cd frontend && npm install && npx vite build --emptyOutDir)
```
</details>

> **왜 `.env.local`을 빌드 전에 만들어야 하나요?**
>
> vite는 빌드 시 `VITE_BASE_PATH`를 산출물 HTML/JS에 박아넣어요. `URL_PREFIX`는 서버가 들어오는 요청 URL에서 같은 prefix를 strip해서 정적 파일을 찾을 때 사용해요. **둘이 일치하지 않으면 404**가 떠요. `.env.example` 기본값 그대로면 둘 다 `/studio`로 자동 일치. `setup.sh`가 이 순서 자동 처리.

### Step 3. NovelAI 토큰 받아서 저장

1. [novelai.net](https://novelai.net) 로그인
2. 좌측 상단 거위 아이콘 → **Account Settings**
3. **Get Persistent API Token** 클릭 → 길고 알 수 없는 문자열 복사
4. 서버에 저장:

```bash
mkdir -p data
nano data/TOKEN.txt
# 복사한 토큰을 붙여넣고 Ctrl+O → Enter → Ctrl+X
chmod 600 data/TOKEN.txt
```

> 토큰 없이 시작해도 돼요. 웹 UI 환경설정에서 이메일/비밀번호로도 로그인 가능. (단 토큰이 더 안정적)

### Step 4. 서버 켜기

**방법 A — 일회성 실행 (테스트용)**:

```bash
node server.js
# 화면에 "Server running on port 6247" 뜨면 OK
# Ctrl+C로 끄면 서버 멈춰요
```

**방법 B — 상시 운영 (추천)**: PM2로 백그라운드 + 자동 재시작.

```bash
sudo npm install -g pm2
pm2 start server.js --name nai-studio
pm2 save
pm2 startup        # 시스템 재부팅 시 자동 시작 — 안내 따라 실행
```

서버 상태 확인:
```bash
pm2 status         # online이면 OK
pm2 logs nai-studio --lines 20    # 실시간 로그
```

### Step 5. 일단 접속 테스트

같은 서버 안에서:
```bash
curl http://localhost:6247/api/build-info
# JSON 응답이 떠야 OK (API는 path prefix 영향 안 받음)
```

같은 네트워크의 다른 기기에서: 브라우저로 **`http://<서버 IP>:6247/studio/`** 열기 (`.env.local`의 `URL_PREFIX` 그대로 따라가야 해요. trailing `/` 필수).

> 자산 404 뜨면 `.env.local`의 `URL_PREFIX` ↔ `VITE_BASE_PATH` 불일치예요. 두 값 맞춰서 frontend 재빌드 (`cd frontend && npx vite build && cd ..`) + 서버 재시작.

### Step 6. 외부 접속 설정 (Tailscale 권장)

집 밖이나 모바일 LTE에서도 접속하고 싶으면 **Tailscale** 추천 (무료, 사설 VPN, 본인 기기만 접근).

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
# 브라우저 인증 링크 떠요. 본인 Google/GitHub 계정으로 로그인

# HTTPS로 노출 (Let's Encrypt 자동, /studio 경로로):
sudo tailscale serve --bg --https=443 --set-path=/studio http://localhost:6247
```

이제 `https://your-host.tailNNNNN.ts.net/studio`로 어디서든 접속 가능. Tailscale 계정에 로그인된 본인 기기에서만 접근됩니다.

> **3 항목 일치 규칙**: `tailscale serve --set-path=<X>` ↔ `.env.local`의 `URL_PREFIX=<X>` ↔ `VITE_BASE_PATH=<X>/` 셋이 같아야 해요. 기본값 그대로면 모두 `/studio`라 자동 일치. 다른 경로로 바꿨으면 `.env.local` 두 항목 수정 후 frontend 재빌드 + 서버 재시작 필수.

> ### ⚠️ 보안 주의사항 (꼭 읽어주세요)
>
> 본 서버는 **인증 미들웨어가 없어요.** 누구나 접근할 수 있는 곳에 노출하면 다음 위험이 있습니다:
>
> - **NAI 토큰 탈취**: 누구든 본인 계정 토큰을 덮어쓸 수 있음
> - **Anlas 크레딧 무단 소진**: 큐 API에 인증 없어 누구든 본인 계정으로 이미지 생성 가능
> - **데이터 삭제**: 누구든 프로젝트/이미지 삭제 가능
>
> **반드시 Tailscale, WireGuard, 또는 동등한 사설망 전용으로만 운영하세요.** 위 `tailscale serve`는 tailnet 전용(본인 기기만)이라 안전해요.
>
> 인터넷에 직접 노출하려면 nginx/caddy basic auth 또는 Authelia 같은 인증 게이트웨이를 *반드시* 추가하세요.

> ### 🔒 더 안전하게 — 외부 포트 닫기 (선택)
>
> Tailscale이 잘 동작하면 **SSH(22번)도 Tailscale 통해 접근 가능**해서 외부 22번 포트는 닫아도 돼요. 보안 그룹에서 22번을 닫으면 인터넷의 brute-force SSH 공격 자체가 차단됩니다. **80/443/6247도 SDStudio Remote 운영엔 외부 노출 불필요해서 같이 닫는 게 안전.**
>
> **순서 (꼭 이 순서로!)**:
> 1. 먼저 Tailscale 설치 완료 + SSH 접속 테스트: `ssh -i key ubuntu@<서버의 Tailscale 호스트명>.tailNNNNN.ts.net`
> 2. Tailscale로 SSH 접속 + 브라우저로 `https://<호스트명>.tailNNNNN.ts.net/studio` 둘 다 잘 되는지 확인 후
> 3. Oracle Cloud 보안 그룹에서 **22 / 80 / 443 / 6247 수신 규칙 전부 삭제**
>
> **왜 80/443도 닫아도 되나?** Tailscale serve는 *Tailscale 인터페이스(`100.x.x.x:443`)에만* 바인딩되고 0.0.0.0:443에는 안 바인딩돼요 (`ss -tlnp`로 확인 가능). Tailscale 메쉬는 자체 outbound UDP(41641 등)로 NAT traversal — Oracle 보안 그룹 inbound 룰과 무관. 즉 외부 80/443/6247은 *빈 포트*라 닫아도 동작 영향 0 + 공격 표면 최소화.
>
> **Tailscale Funnel(인터넷 전체 노출)이나 다른 서비스(nginx 등)를 같은 인스턴스에서 운영하면** 그 서비스가 쓰는 포트만 보안 그룹에 추가하세요. SDStudio Remote만 쓸 거면 닫기.
>
> 만약 Tailscale이 안 되는데 22번을 닫으면 서버 영영 못 들어가요. **반드시 Tailscale SSH 동작 확인 후** 닫으세요.

### Step 7. 태그 자동완성 활성화 (선택)

Danbooru 태그 DB(`db.csv`)를 서버 `~/nai-studio/data/` 폴더에 두면 자동완성이 켜져요.

**db.csv 받는 법** — SDStudio PC 버전(Windows)에 포함된 파일 그대로 사용 가능:

1. Windows PC에서 SDStudio Electron 앱 데이터 폴더 열기:
   - 경로: `%APPDATA%\SDStudio\SDStudio\db.csv`
   - 또는 윈도우 키 → "실행" → `%APPDATA%\SDStudio\SDStudio` 입력 → Enter
2. `db.csv` 파일을 본인 PC 어딘가에 복사
3. SCP/SFTP 등으로 서버에 업로드. WinSCP 같은 GUI 툴 또는 명령어:

```bash
# 본인 PC (Windows PowerShell 또는 Mac/Linux terminal)에서:
scp 본인PC의db.csv경로 ubuntu@서버주소:~/nai-studio/data/db.csv

# 예) Windows PowerShell:
scp "$env:APPDATA\SDStudio\SDStudio\db.csv" ubuntu@1.2.3.4:~/nai-studio/data/db.csv
```

서버에 이미 있는 db.csv를 옮기는 경우엔 서버 SSH 안에서:
```bash
mv ~/어딘가/db.csv ~/nai-studio/data/db.csv
```

db.csv 없어도 SDStudio Remote는 동작합니다 (자동완성 기능만 비활성화).

### Step 8. SDStudio PC 데이터 이전 (선택)

기존 SDStudio PC 사용자라면 프리셋/바이브를 가져올 수 있어요.

Windows SDStudio 데이터 위치: `%APPDATA%\SDStudio\SDStudio\`

복사할 폴더:
- `projects/` → `data/projects/`
- `vibes/` → `data/vibes/`
- `inpaints/` → `data/inpaints/`
- `config.json` → `data/config.json`

---

## 사용 방법

### 기본 흐름

1. **프로젝트 만들기** → 좌측 상단 프로젝트 선택 → "신규 프로젝트"
2. **씬 추가** → "씬 추가" 버튼 → 이름 입력
3. **프롬프트 설정** → 씬 클릭 → 편집 모드에서 프롬프트 입력
4. **생성 개수 설정** → 상단 "개수" 옆 ◀▶ 또는 텍스트 입력 (기본 1)
5. **시작** → 우측 ▶ (Play) 버튼
6. **진행 확인** → 상단 알약에 "X개 남음 (예상 X초)" 표시. 클릭하면 task list
7. **정지/재개** → ⏸ 클릭 (일시정지) → ▶ 클릭 (재개)

### 모바일 사용 시

- 폰 화면 꺼두거나 앱 background 가도 서버가 계속 처리해요
- 다시 앱 열면 30초 안에 알약/리스트가 자동 동기화됩니다
- 프롬프트 입력 시 텍스트 영역 클릭하면 전체 화면 편집 모드로 전환
- 자동완성 뜨면 모바일 세로는 상하 분할, 가로는 좌우 분할로 보여줘요

### 이미지 내보내기

씬 카드 영역의 **"이미지 내보내기"** 버튼 클릭하면 메뉴 뜸:

- **즐겨찾기 이미지만** / **모든 이미지 전부**
- **⚙️ 내보내기 프리셋 설정** — 자주 쓰는 설정 저장 (3개까지). 파일 이름 형식 옵션:
  - `(씬이름).(번호).png`
  - `(캐릭터).(씬이름).(번호)` — 프리셋에 캐릭터 이름 미리 박음
  - `(캐릭터).(씬이름).(번호) — 이름 직접 입력` (v1.7.3) — 내보내기 시점에 dialog로 캐릭터 이름 입력. 프리셋 수정 없이 프로젝트별 다른 이름 가능
- 프리셋이 있으면 **★ <프리셋이름>(으)로 내보내기** 항목도 보임 → 클릭 시 다이얼로그 없이 즉시 실행

내보내기는 서버 백그라운드에서 처리돼요 (resize → zip → Drive 업로드 옵션). 브라우저 닫아도 계속.

### 프로젝트 파일 다중 내보내기 (project.json)

프로젝트 선택 picker(상단 좌측)의 **"내보내기"** 버튼 클릭 → 트리에서 N개 선택 dialog 뜸:

- 폴더 + 루트 프로젝트 섞어 체크박스로 선택. 폴더 체크박스는 3-state (전체/일부/none).
- "내보내기 (N개) — 백그라운드" 클릭 → picker 즉시 닫힘 + 메인 화면 progress dialog `X/N` 카운터.
- Drive 가용시 4개 병렬 큐 등록, 미가용시 브라우저 다운로드 직렬.
- 진행 중 그 프로젝트 삭제/이름변경 시도하면 "백그라운드 내보내기 중이에요" 차단.
- 끝나면 "✓ N개 프로젝트 내보내기 완료" 토스트.

---

## queue.html — 큐 진행 상황 페이지

본 서버에 자동으로 같이 설치돼요. 별도 설치 X. 메인 페이지 옆에 다음 URL로 접속:

- `https://your-host.tailNNNNN.ts.net/studio/queue.html`
- 또는 (메인이 `/`에 있으면) `http://localhost:6247/queue.html`

표시 내용:
- **NAI 이미지 큐**: 대기/완료/실패, 평균 시간 (X.XX초), 남은 시간 예상, 진행률 (X.XX%)
- **대기 카드 클릭** → 폴더/프로젝트/씬 3단 트리 펼침 (default 모두 접힘). 각 row 우측 ✕로 폴더·프로젝트·씬 단위 큐 취소(확인 모달 거침)
- **평균(누적) 클릭** → 최근 200개 처리 시간 sparkline + list
- **완료 탭** — 프로젝트별 batch로 묶어서 표시. 4시간 retention + 30분 gap으로 같은 batch 식별. 처리 중 프로젝트 잔여 수도 같이 보여줌
- **큐 통계 영구 누적** — 2시간 단위 12-bucket(24시간) KST 기준 처리량
- **Drive 업로드** 섹션: 진행 중 항목, 재시도 일정, 실패 사유. 즉시 일제 재시도 / 포기 / failed → pending 리셋 버튼
- **이미지 내보내기 처리** (active 시): resize/zip phase, 진행 바. 진행 중 job 취소 버튼
- **최근 NAI 큐 에러** (발생 시): 429/5xx/기타 분류, 친절 메시지, 씬이름·번호
- **전체정리 미리보기** — 정리 전에 삭제될 항목 모달로 확인 (iOS Safari `confirm()` 회피용 HTML 모달)

모바일에서 별도 탭으로 켜놓고 진행 상황 모니터링 좋아요.

---

## 업데이트 방법

새 버전 나오면 화면 우측 상단(PC) / 알약(모바일)에 **🔄 업데이트** 표시가 뜹니다.

> **v1.7.3+**: 두 종류 펄스가 별도 표시돼요.
> - 🔄 orange: 본 fork(SDStudio Remote) 새 버전 — 클릭하여 자동 업데이트
> - 🔧 indigo: 업스트림 SDStudio(Dd154663) 새 release — 클릭하여 release notes 새 탭. 본 fork이 따라잡을 때까지 기다리거나 본인이 직접 patch port 시도 가능

### 방법 1 — UI 자동 (v1.7.0+, 권장)

알약 클릭 → 모달의 **'지금 업데이트'** 누르면 끝. 단계별 진행률(checking → pulling → installing → building → restarting)이 progress bar로 표시되고, 완료 후 '새로고침' 버튼 누르면 새 버전 자동 활성. **SSH 접속 불필요**, iPhone에서도 한 클릭으로 가능.

- 인증: **NAI 로그인 상태면 자동 통과** (별도 토큰 입력 없음). 로그아웃 상태면 401 안내.
- 동시 두 번 트리거 차단 (lock).
- 진행 중 모달 닫기 차단 (canClose=false).
- pm2 사용 환경 한정 (`update.sh`와 동일 명령으로 자기 자신 재시작).

### 방법 2 — 수동 SSH (대체)

UI 사용 불가하거나 트러블슈팅 필요 시:

```bash
cd ~/nai-studio && ./update.sh
```

`update.sh`가 자동으로:
1. GitHub에서 최신 코드 pull (`--ff-only`)
2. 의존성 갱신 (root + frontend)
3. 프론트엔드 재빌드 (`vite build`)
4. `build-info.json` 갱신 (gitHash + version)
5. pm2로 서버 재시작 (`--update-env`로 `.env.local` 환경변수 재주입)

**데이터(프리셋, 이미지, 큐 상태, 설정)는 그대로 유지됩니다.** 큐 영속화 시스템이라 pm2 restart 중 큐 데이터 안전.

---

## 환경변수

`~/nai-studio/.env.local` 파일에 작성하면 자동 로드됩니다 (선택).

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `PORT` | `6247` | 서버 listen 포트 |
| `URL_PREFIX` | (빈 값) | 리버스 프록시 경로 (예: `/studio`) |
| `RCLONE_REMOTE` | (미설정) | rclone remote 이름. **미설정 시 Drive 기능 모두 자동 disabled** (rclone 호출 0건). 사용하려면 [Google Drive 동기화](#google-drive-자동-동기화-rclone) 가이드 참조 |
| `RCLONE_REMOTE_BASE` | `NAI-Studio` | Drive 안 베이스 폴더 |
| `DRIVE_RETRY_CONCURRENCY` | `3` | Drive 재시도 큐 동시 처리 개수 |
| `EXPORT_CONCURRENCY` | `10` | 이미지 내보내기(서버 측 resize/zip) 동시 job 수 |
| `NAI_PM2_NAME` | (디렉터리명) | update.sh가 사용할 pm2 app 이름 |

예시 `.env.local`:
```bash
PORT=6247
URL_PREFIX=/studio
# Drive 안 쓰면 아래 줄 제거 (default가 빈 값이라 Drive 기능 자동 off)
RCLONE_REMOTE=mygdrive
```

---

## 고급 설정 (선택)

### Google Drive 자동 동기화 (rclone)

**Drive 없이도 서비스 전체 사용 가능해요.** Drive 설정하면 내보내기 결과(`data/exports/`)가 자동 백업되고, 서버 디스크가 가득 차도 안전합니다.

> **opt-in 모드**: `RCLONE_REMOTE` 환경변수 미설정이면 rclone 호출 0건 — Drive 관련 background 작업(자동 업로드 / 재시도 큐 / 30초 폴링) 모두 자동 skip. 본 가이드는 Drive 쓰고 싶을 때만 따라하면 돼요.

#### 1. rclone 설치 + Google Drive remote 인증

```bash
curl https://rclone.org/install.sh | sudo bash
rclone config
```

`rclone config` wizard 진행:

1. `n` (New remote) 선택
2. **name**: 원하는 이름 입력 (예: `mygdrive`, `nai-drive` 등 — 본인이 식별 가능한 이름). 이 이름이 곧 `.env.local`의 `RCLONE_REMOTE` 값.
3. **Storage**: `drive` (Google Drive)
4. **client_id / client_secret**: 빈 값으로 두면 rclone의 default app 사용 (간단). 또는 본인 Google Cloud Console에서 만든 OAuth client 사용 가능.
5. **scope**: `1` (drive — full access) 또는 `2` (drive.file — rclone이 만든 파일에만 접근, 더 안전).
6. **service_account_file**: 빈 값.
7. **Edit advanced config**: `n`.
8. **Use auto config**: `y` (브라우저로 OAuth) — 헤드리스 서버면 `n` 선택하고 다른 머신에서 `rclone authorize "drive"` 결과 복사.
9. **Configure as Shared Drive**: 보통 `n`.
10. **Confirm**: `y` → `q`로 종료.

#### 2. `.env.local`에 remote 이름 박기

```bash
# ~/nai-studio/.env.local
RCLONE_REMOTE=mygdrive   # ← 위에서 정한 remote 이름 그대로
RCLONE_REMOTE_BASE=NAI-Studio   # Drive 안 베이스 폴더 (기본 'NAI-Studio')
```

서버 재시작 (또는 `./update.sh`) 후 좌측 하단 `📤` 위젯에서 자동 동기화 진행 확인 가능.

#### 3. 검증

```bash
rclone lsd mygdrive:   # remote 동작 테스트 — 본인 Drive 폴더 목록 출력되면 OK
```

#### 4. 추가 동기화 (선택) — 30분마다 데이터 전체 백업

내보내기 외에 프로젝트/바이브 등도 자동 백업하려면 cron 등록:

```bash
# .env.local에 RCLONE_REMOTE 박혀 있다고 가정. cron 안에선 환경변수 자동 로드 안 되니까
# remote 이름을 직접 적어주세요 (아래 'mygdrive'를 본인 이름으로 교체)
cat > ~/sync_naistudio.sh << 'SHEOF'
#!/bin/bash
LOG="$HOME/sync_naistudio.log"
REMOTE="mygdrive"   # ← 본인 remote 이름으로 교체
BASE="NAI-Studio"
rclone sync ~/nai-studio/data/ "${REMOTE}:${BASE}/data/" \
  --exclude "tmp/**" --exclude "**/fastcache/**" --exclude "**/.trash/**" \
  --log-file="$LOG" --log-level INFO
rclone copy ~/nai-studio/data/exports/ "${REMOTE}:${BASE}/data/exports/" \
  --log-file="$LOG" --log-level INFO
SHEOF
chmod +x ~/sync_naistudio.sh

crontab -e
# 추가:
*/30 * * * * ~/sync_naistudio.sh
```

### 디스크 자동 정리

`server.js`에 디스크 부족 자동 cleanup 내장:
- **Stage 1** (5GB 미만): `tmp/`, `exports/` 7일+ 삭제
- **Stage 2**: 30일+ outs 이미지 정리
- **Stage 3**: 큐 일시정지 + 알림
- **Stage 4** (Drive 백업 활성 시): Drive에 이미 있는 파일 로컬 삭제

설정은 `server.js` 상단의 `DISK_*` 상수에서 조정.

---

## 보안 / 프라이버시

본인 서버에 설치하는 거라 "데이터가 어디로 가고 어디에 저장되나"가 다른 클라우드 서비스보다 명확합니다. 위협 모델 + 데이터 흐름 그대로 적어요.

### 위협 모델 — tailnet/VPN/localhost 전용

이 앱엔 **인증 미들웨어가 없어요.** 서버에 도달할 수 있으면 누구나 NAI 토큰 탈취 / 본인 크레딧 소진 / 데이터 삭제 가능. 그래서 **반드시 Tailscale, WireGuard, 또는 사설망/localhost 전용으로만 운영하세요.** Step 6의 `tailscale serve`가 정답.

> 인터넷에 직접 노출이 필요하면 nginx/caddy basic auth 또는 Authelia 같은 인증 게이트웨이를 **반드시** 앞단에 두세요.

기본 방어선:
- ✅ Path traversal 차단 (`resolvePath()` `DATA_DIR` 검증)
- ✅ `TOKEN.txt` `/api/fs/*` 차단 (sensitive blacklist) — `chmod 600` + API 노출 X
- ✅ rclone `execFile` array args — command injection 면역
- ✅ `/api/auth/login` rate limit (5회/분, IP 기반)
- ✅ CSP enforce + 보안 헤더 5축 (X-Frame-Options DENY, X-Content-Type-Options, Referrer-Policy no-referrer, Permissions-Policy, CSP)
- ✅ WebSocket same-origin 검사 (cross-origin 차단)

#### 자동 업데이트(v1.7.0+) 위협 모델

- **인증**: `POST /api/self-update` = NAI 로그인 상태(서버 측 `nai.token` 존재)로 검증. logged-out 401. 동시 두 번 트리거 차단 락.
- **실행 명령**: 고정 4단계 (`git pull --ff-only` / `npm install` / `vite build` / `pm2 restart`). user input 안 들어감 — command injection 면역.
- **권한 범위**: server 프로세스 user(`ubuntu`) 권한 내 — root X.
- **신뢰 영역**: Tailnet 안 사용자가 같은 `nai.token` 사용 중이면 update 트리거 가능. 본인이 들여보낸 신뢰 사용자 가정. **인터넷 노출 시점에 위협 변화** — 외부 사용자가 NAI 계정 알면 update 트리거 가능 → 외부 노출하면 위 방어선(인증 게이트웨이 등) 필수.
- **회귀**: 회귀 시 SSH로 `git checkout <prev tag> && ./update.sh` 수동 복귀. Phase 1/2 backup 트랜잭션 없음(git이 대체).

### 외부 통신 — 어떤 데이터가 어디로 가나

이 서버가 외부로 보내는 통신은 **세 곳뿐**이에요. 다른 telemetry/analytics/CDN/error-reporting 0건.

| 호스트 | 무엇 | 데이터 |
|---|---|---|
| `api.novelai.net` | NAI 로그인 + 크레딧 조회 | 이메일+비밀번호(argon2 hash) → 액세스 토큰 |
| `image.novelai.net` | 이미지 생성 / augment / encode-vibe | 프롬프트 + 파라미터 + 입력 이미지 (base64) |
| `raw.githubusercontent.com` | 업데이트 알림 — `version.json` GET only | **0 (데이터 전송 안 함, 다운로드만)** |
| Google Drive (rclone) | **선택** — 사용자가 `RCLONE_REMOTE` 설정 시 | 내보내기 결과 이미지 zip |

비활성화:
- 업데이트 알림 끄려면 `NAI_STUDIO_VERSION_URL=` (빈값)으로 환경변수 설정. 5분 캐시 GET 한 번도 안 나감.
- Drive 안 쓰면 `RCLONE_REMOTE` 미설정. rclone 호출 0건.

### 로컬에 저장되는 데이터

전부 `data/` 디렉토리 안 + pm2 logs. **외부 전송 X.** 같은 서버에 shell 접근 가능한 다른 OS 사용자가 있으면 볼 수 있어요.

| 경로 | 내용 | 권한 |
|---|---|---|
| `data/TOKEN.txt` | NAI 액세스 토큰 (평문) | `chmod 600` (owner only) |
| `data/config.json` | 사용자 설정 (model version, thumb size 등) | 644 |
| `data/projects/*.json` | 씬 + 프롬프트 + 캐릭터 + vibe | 644 |
| `data/outs/<project>/<scene>/*.png` | 생성 이미지 | 644 |
| `data/bookmarks.json` / `favorites.json` / `global_pieces.json` / `trash.json` | 큐레이션 | 644 |
| `~/.pm2/logs/<app>-out.log` | 에러, 큐 진행, 디스크 cleanup | 644 |

**Generate request 로깅은 기본 off.** 프롬프트가 pm2 logs에 박힐 수 있어서 default false로 변경됨. 디버깅 필요 시 `DEBUG_GENERATE_LOG=true` 환경변수로 활성화.

### 보안 환경변수 (참고)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `DEBUG_GENERATE_LOG` | `false` | `true`로 설정 시 매 generate request의 파라미터(프롬프트 포함, binary truncate)를 pm2 logs에 기록 |
| `NAI_STUDIO_VERSION_URL` | (git remote에서 derive) | 빈값으로 설정 시 업데이트 알림 자체 비활성화 |

### Port 22 (SSH) 외부 노출 정리 — 실측 + 절차

본 운영자가 약 한 달간 fail2ban + sshd hardening 상태로 운영하면서 측정한 자료. publickey 인증 + `PasswordAuthentication no`만 박혀있어도 침투는 0건이지만, port 22 외부 노출 자체로 로그 노이즈 + sshd CPU/bandwidth 부담이 누적돼요. Tailscale 들어와있으면 Oracle 보안그룹에서 port 22 제거 권장.

**측정 (2026-04-19 ~ 2026-05-17, ~30일)**

| 구간 | Invalid user 시도/일 | preauth probe/일 | fail2ban 자동 ban/일 | 침투 성공 |
|---|---|---|---|---|
| port 22 open (~22일) | 평균 307 (최대 550) | 평균 555 (최대 1163) | 평균 17 (최대 52) | **0** |
| port 22 close 후 (7일) | **0** | **0** | **0** | 0 |

publickey + `PasswordAuthentication no` + fail2ban 셋이 박혀있으면 외부에 22 열려있어도 안전은 유지돼요. 다만 닫으면 로그가 깨끗해지고 sshd 부담도 0이 됨.

**Oracle Cloud 보안그룹에서 port 22 제거 절차**

⚠️ 닫기 전 안전망: Tailscale SSH 새 세션을 별도 터미널로 열어두세요. Oracle 룰 잘못 건드려도 이미 열린 세션은 살아있어서 복구 가능.

1. Oracle Cloud Console → 햄버거 ☰ → **Networking** → **Virtual Cloud Networks**
2. 본인 VCN 클릭 (instance가 묶인 VCN. 확신 안 되면 **Compute → Instances → 본인 instance → "Virtual Cloud Network"** 필드로 확인)
3. VCN 상세 페이지 → 왼쪽 사이드바 → **보안 목록**
4. ingress rule에 `0.0.0.0/0` source + TCP destination port `22`가 있는 보안 목록 클릭
5. 해당 룰 우측 ⋮ → **Remove**
6. (NSG도 쓰는 경우) **네트워크 보안 그룹** 페이지에서도 동일하게 port 22 룰 제거

룰 제거 후 5-10초 안에 반영. **이미 연결된 SSH 세션은 state 매칭으로 유지**되니까 끊기지 않음. 새 SSH 시도는 timeout (Oracle이 silently drop).

> 알려진 안전한 ingress rule (그대로 유지):
> - `10.0.0.0/16 TCP 22` (VCN 내부 전용 — 외부 X)
> - `0.0.0.0/0 ICMP 3,4` (MTU path discovery)
> - `10.0.0.0/16 ICMP 3` (내부 unreachable 통보)

---

## 자주 묻는 질문

### Q. Google Drive 없이도 쓸 수 있나요?
**네**. NAI 이미지 생성, 큐, 내보내기 (zip 파일로 로컬에) 다 됩니다. Drive 설정 안 하면 자동 백업/업로드 기능만 비활성화. 그래도 서버 디스크에 모든 파일 남아있어요. `data/exports/`에서 직접 다운로드 가능.

### Q. 폰만으로도 설치 가능한가요?
설치는 SSH 가능한 환경(보통 PC) 필요. 한 번 설치 끝나면 그 다음부턴 폰으로만 사용 가능합니다.

### Q. 큐 진행 중 서버를 재시작하면 잃나요?
**잃지 않아요.** 큐 상태가 disk(`data/.queue_state.json`)에 영속화돼서 재시작 후 자동 복원됩니다. 진행 중이던 1장만 잃을 수 있어요.

### Q. 모바일에서 알약이 안 움직여요
WebSocket 끊긴 상태일 수 있어요. 새로고침 한 번 하면 즉시 동기화. 30초 주기로 자동 동기화도 돼요.

### Q. NAI 429 (rate limit) 떴어요
서버가 자동으로 5초 대기 후 10회 재시도해요. 그래도 실패면 `queue.html`의 "최근 NAI 큐 에러" 섹션에 기록됩니다.

### Q. 업데이트 알림이 안 사라져요
`update.sh` 실행 후에도 알림 그대로면 브라우저 캐시 새로고침 (모바일은 새로고침 + 캐시 비우기). 또는 `curl localhost:6247/api/build-info`로 현재 버전 확인.

### Q. iOS Safari에서 이미지 내려받기가 새 탭으로 열려요
v1.5.3부터 단일 이미지 "다운로드" 버튼은 Drive 가용 시 자동으로 Drive에 올려요(다이얼로그 없음). Drive에서 받으세요. Drive 미사용 환경에선 브라우저 직접 다운로드(`<a download>`)로 fallback — iOS 13+는 정상 다운로드, 새 탭 열리는 옛 케이스는 거의 없어요.

---

## 변경 이력

세부 변경 이력은 [CHANGELOG.md](CHANGELOG.md) (v1.5.0-preview.4까지 누적 기록) + 최근 변경은 `version.json` 의 `notes` 필드 / `git --no-pager log` 로 확인 가능해요.

**최근 변경 (요약)**:
- **post-v1.7.3 patches (2026-05-22~23)**: 프로젝트 임포트 폴더 dropdown 사용자 강제 선택(자동 default 폐기, MultiImportNameDialog + 단일 N=1 통합) / 큐 잡 사이 지연 fix — 서버 영속화 base64 content-hash dedupe(`.queue_state.json` 67MB → 0.93MB, stringify 188ms → 4ms) + 클라 prepGenInput config 캐시(task당 1회 fetch로 N×roundtrip 제거) / **그림체 프리셋 동작 자유 합성** — 옛 적용 시 front/back/uc 슬롯 lock(hide) + 통째 덮어쓰기 폐기, 새 동작 = 슬롯 항상 보임 + 사용자 슬롯 텍스트 앞에 합쳐서(prepend) 적용 + sampler params 폐기(스탭/샘플러/가이던스/리스케일/노이즈 옵션 제거) + 그림체 안에서 `<lib.name>` 조각 참조 가능(옛 throw 제거) + 모바일 헤더에 조각 편집기 진입점 퍼즐 아이콘 추가 / 데스크탑 ctrl(Win/Linux)·cmd(macOS)+좌클릭으로 이미지 선택 모드 자동 진입 + 선택 / WS application-level heartbeat 30s ping/pong + 10s timeout — iOS Safari WS idle silent stale(`onclose` 미발화) 직접 감지 후 reconnect / 큐 mirror 진행 카운터 30s 폴링 시 0으로 reset되던 부수효과 fix(`_doRestoreMirroredState` done 보존, mock 5/5 PASS) / **씬 카드 우측 하단 카운터/썸네일 stale fix** — restored mirror task가 task.params 빈 placeholder라 `afterGenComplete` 스킵되던 사각지대, `scene-job-complete` listener를 결과 viewer-local에서 App.tsx-global로 이동(view 무관 cover) + 큐 'stop' refreshBatch 안전망 + sceneKey-scoped 1s debounce(burst 150 → 2 refresh = 99% 감소, 모바일 발열 hardening) / `scripts/regen-build-info.sh` helper — direct commit 흐름에서 `public/build-info.json` 누락 사고(P19 #6 재발) 차단 / **폴더 전체 내보내기 outer tar 안에 프로젝트별 inner tar (nested)** — 옛 outer.tar 안에 모든 이미지가 폴더 구조로 평탄 배치였던 것을 `proj1.tar`, `proj2.tar` ... inner tar로 묶음. 프로젝트별 추출이 즉시 가능. 폴더 export만 nested, 단일 프로젝트 export는 옛 동작 그대로 / **데스크탑 Chrome 클립보드 복사 회귀 fix** — `copyImageToClipboard`이 fetch await 후 `clipboard.write` 호출 시 Chrome user activation 만료로 NotAllowedError. `ClipboardItem({'image/png': Promise<Blob>})` 패턴으로 재작성(Chrome이 resolve까지 activation 유지). silent catch 제거 + 호출측 verbatim 에러 토스트 / **씬 안 '이미지 복사' 버튼 OS 클립보드도 함께** — 옛엔 내부 `imageClipboard` state(씬간 paste용)만 갱신해 OS 클립보드는 무관. async 변환 + 첫 장은 OS 클립보드에 PNG 복사, 옛 씬간 paste 동작 그대로 유지 / 새로고침 시 큐 task 분모 deflate fix — `meta.jobTotal`로 originalTotal 복구 / **PC 인페인트 씬 뷰포트 fit-to-viewport** — 옛 고정 0.7× 스케일로 큰 이미지(미러 캔버스 등)가 화면 밖으로 흘러서 브라우저 줌 67%까지 내려야 보이던 페인 해결. 이미지 dimension 확정 시 컨테이너 측정 후 fit scale 자동 계산해서 중앙 배치 + minScale 0.1로 추가 축소 허용 + pan 자유. 모바일은 기존 동작 그대로 / **폴더 전체 백업 (이미지 없이, 가볍게) tar 안 layout 평탄화** — 옛엔 `{프로젝트명}/project.json` (각 프로젝트가 폴더, 그 안에 .json)이었는데 이미지 없으면 폴더로 감쌀 의미 없어서 `{프로젝트명}.json` (폴더 없이 평탄)으로. 이미지 포함 백업은 옛 nested layout 그대로(media dir 들어가야 해서). 옛 light .tar import 호환 유지(마커 `format` 필드 누락 = nested 가정) / **큐 패널 디스크 정리 옵션** — 큐 pill 안에 '🧹 디스크 정리' 섹션 추가. outs / exports / tmp / inpaints / vibes 5종 사이즈·파일수 표시 + 체크박스(default outs/exports/tmp on, inpaints/vibes off — 작업 원본 손실 위험) + confirm dialog 후 폴더 안 통째 rm. `/api/disk/usage` GET + `/api/disk/cleanup` POST (화이트리스트 strict, path traversal 차단). `cleanup_old_files.sh`(7일 cron) / `cleanup-orphans`(비활성 프로젝트) / `diskCleanupStageN`(disk-low 자동)과 별개 즉시 trigger 경로. 큰 폴더(예: exports 3GB+) rm 대비 클라 timeout `FOLDER_DELETE_TIMEOUT_MS`(600s) / **큐 한도 5000 → 7000 증액 + 한도 도달 시 토스트 안내** — 옛엔 한도 도달 시 add-batch가 silent rejected라 사용자가 "UI 카운터 5600 → 새로고침 후 4750으로 줄어듦"을 "사라졌다"고 인지하던 페인. 옛 add 단일은 broadcast 'queue-full' 박혔지만 add-batch에 누락 + 클라 측 listener 부재로 한도 도달 시그널 silent. 처방: 한도 7000(평소 < 5000 + 가끔 5천대 cover), add-batch에 broadcast 추가, 클라 측 `onQueueFull` listener + 토스트 "큐가 가득 차서 N개가 등록 안 됐어요 (한도 7000개)" / **큐 등록 silent throw 안전망** — `addMirroredTask` try-finally에 catch 없어서 prep/queueAddBatch network throw 시 UI 카운터 부풀린 채 잔류 + 새로고침 시 deflate + 재등록 시 부분 성공 잡과 중복 가능. 처방: try-catch-finally, catch에서 sync block에 박은 stats를 task.total 기준 정확 unwind + mirroredTasks/mirrorTaskSceneKeys 등 정리 + throw e (caller `.catch`가 글로벌 토스트). 측정 인프라 [P21-DIAG] console.error 동시 박음 — 다음 사고 시 `pm2 logs | grep '[P21-DIAG]'`로 근본 원인 추적 / **폴더/프로젝트 메뉴 '한 번에 큐 등록'** — 프로젝트 선택 dialog에서 폴더·프로젝트 옆 점세개(⋮) 메뉴에 주황색 '🚀 한 번에 큐 등록' 항목. 폴더는 안의 모든 프로젝트의 모든 씬, 프로젝트는 그 안 모든 씬을 scene+inpaint 통합해서 한 씬씩 await 순차 등록(CHUNK=1, 누락 0) + sceneKey dedup(이미 큐/mirror에 있는 씬은 skip) + 진행 toast ✕ 취소 버튼(취소 시점 이후 잡 안 들어감, 이미 들어간 잡 유지). 부수 — `ConfirmWindow` select item에 per-item `color` 옵션(`amber`/`green`/`red`), `ProgressDialog`에 `onCancel` 필드 + X 버튼
- **v1.7.3** stable (2026-05-21): 프로젝트 다중 내보내기 (트리 picker + 백그라운드 + 4-병렬 + 소프트 락) / Drive 위젯 row별 [재시도] 즉시 처리 + 시각화 (옛 reset+대기 → reset+즉시 통합) / SDStudio upstream v4.8.1+v4.8.2 통합 — 캐릭터 프리셋 orphan cleanup + 교체 시 residue clear + 모바일 해제 dialog + 내보내기 `prefix_ask` 캐릭터 이름 직접 입력 / 업스트림 SDStudio 새 release indigo 펄스 알림(`/api/sdstudio-version-check` + BuildInfo dual pulse). 부수 — clearAppliedCharacterPreset 모든 presetShareds 순회 fix + retry-reset dead code 정리. sdstudioBase 4.8.0 → 4.8.2
- **v1.7.2** stable (2026-05-21): v1.7.1 dogfood 후속 sanitize sweep — fresh install 안내 정확화 (`~/nai-studio` 경로 정규화, rclone wizard 본문 + 기본값 사실수정), 업데이트 알림/Config 'GitHub' 링크 본인 fork 정정, self-update stderr abs path 마스킹, TLS cert (`*.crt/.key/.pem`) gitignore 가드, default assets metadata 스트립 + `ixy.png` 잔재 삭제
- **v1.7.1** stable (2026-05-21): WS path strip fix (`WebSocketServer` → `noServer` + server 'upgrade' handler로 `URL_PREFIX` strip을 WS upgrade에도 적용) — path strip 안 하는 reverse proxy (lxc proxy / 직접 포트 / Cloudflare Tunnel / nginx without `proxy_pass /`) 환경에서 WS 끊김 → 폴링 30초 fallback 페인 fix. v1.7.0 이후 4일 누적 (84 commit) — audit 11카테고리 P17 Critical 9건 + P18 High 18건 + Medium/Low ~80건 fix, 큐 race/카운터/cancel ≠ complete 분리, queue.html 폴더 트리 + 단위별 취소, 폴더 백업 동시 + 이미지 미포함 옵션, dead-code 삭제, runtime audit 11 카테고리 인스트럭션 도입
- **v1.7.0** stable (2026-05-17): 자동 업데이트 시스템 — `POST /api/self-update` NDJSON 스트림 (`checking → pulling → installing → building → restarting`) + BuildInfo `UpdateModal` phase machine + NAI 로그인 인증 통과. SSH 접속 없이 UI 한 클릭으로 `git pull → npm install → vite build → pm2 restart`. iPhone에서도 가능. README "업데이트 방법" + SDStudio 비교 표 갱신
- **v1.6.1** stable (2026-05-17): 큐 race fix (`restoreMirroredState` single-flight 가드), 큐 list UI 전면 리뉴얼 — 폴더 → 프로젝트 → 씬 3단 트리(default 다 접힘) + 우선순위 큐(씬/프로젝트 ⭐ toggle + 두 섹션 + divider) + 카운터 snapshot/vanish(레벨 단위 누적, 분모 고정) + 처리 중 폴더/프로젝트 펄스 + portal로 X 안 닫히는 회귀 fix + 가로 스크롤 차단 + 컴팩트 row + ㄴ 연결자, 다중 프로젝트 임포트(드래그드롭 ≥2 자동 감지 + iOS multi picker + 페이지당 4개 이름 입력 UI), 헤더/버튼 rename
- **v1.6.0** stable (2026-05-17): SDStudio v4.8.0 부분 흡수 (references 백업 회귀 fix / 캐릭터 프리셋 v2 UI 대개편 + JSON I/E + 순차 생성), catalog 정리 149건(명백 8 + C 12 + A 91 + B 38), 즐겨찾기 export 폴백 fix, queue stuck fix, visibility flush data-loss fix
- **v1.5.3** stable (2026-05-15): 폴더 시스템 + 폴더 전체 백업/복원(1 tar + Drive `backups/` 자동 분류, `listFilesRecursive` 5병렬), 단일 이미지 다운로드 → Drive 직행(다이얼로그 폐기), 씬 자동 갱신 disk polling 안전망, UI 일체화 3건(커스텀 해상도/씬 이름 내보내기/이미지 변형 평탄화), 보안 감사 7건 일괄(TOKEN 차단/CSP enforce/execFile/rate limit/log opt-out), 모바일 페인 묶음(vibe/reference fit, BatchItemSelector longpress 통합, iOS click delay 우회), 인터넷 느린 환경 fit(gzip + WebP + 초기 크기 자동 + sticky 토스트), 첫 install 하이진(.env.local + version.json fallback), 로그인 sticky 토스트 + H2 회귀 fix
- **v1.5.3-experimental.1~2** (2026-05-13~14): `BatchItemSelector` 신규 picker로 구 `SceneSelector` 전체 swap (의존성 격리 + 썸네일 + imageRevision 외부 신호), `Types.ts preset: any → PresetLike`, queue.html 모바일 paint/배터리/서버 부담 7축 개선, `saveInpaintImages` 2-phase commit, ModalOverlay focus trap, extractApiError 401/429/timeout 한국어 매핑
- **v1.5.3-preview.1~3** (2026-05-13~14): 폴더 전체 내보내기(프리셋 일괄 적용 + 1zip + 큐 등록 4 병렬), `ResourceSyncService` get(retry: true), 네트워크 회복성 3축(클릭 차단 / 리스트 캐시 / fetch timeout), 5/14 회귀 묶음 fix(캐시 헤더, 예약 취소 cross-project, 씬 선택 렉), queue.html 전체정리 미리보기 + iOS confirm HTML 모달, 보안 헤더, atomicWriteFile + driveRetry 큐 한도 5000 + LRU
- **v1.5.2** (2026-05-13): 씬/조합 단위 네거티브(`scene.uc` + `PromptPiece.uc`), queue.html 처리 중 프로젝트 표시 + 잔여 수, 백그라운드 복귀 시 export 동기화, 이미지 내보내기 동시 10개 + 취소 버튼, 흰화면 회귀 fix(lazy queueMicrotask)
- **v1.5.1** (2026-05-12~13): 씬 일괄 임포트 UI(스키마 + dryRun + overwrite/skip), 프로젝트 영구 삭제(로컬 5 + Drive 5 폴더 병렬) + orphan 정리, 프로젝트 폴더 시스템 + 받침 헬퍼, 씬 통합(조합 슬롯 dedup + 이미지 합치기), 큐 통계 2시간 12-bucket 영구 누적, 모바일 씬 카드 200_ fastcache(다운로드 14배 ↓), NAI 5xx도 429 패턴으로 retry
- **v1.5.0** (2026-05-12): 클라 → 서버 큐 통합 (mirror, 폰 닫아도 진행), 내보내기 프리셋, 개수 ◀▶ 컨트롤, 태그 자동완성 split layout, queue.html sparkline + 친절 에러, Drive 병렬 업로드, rclone remote 환경변수화, 큐 cancel disk 동기화
- **v1.5.0-preview.1~6** (2026-05): Progress UI 알약 통합, Drive 재시도 backoff, zip ENOENT skip, 이미지 내보내기 server pipeline (HTTP 202 + WS), 알림 색 통일, mirror 인프라
- **v1.4.x** (2026-05): PolyForm Noncommercial 1.0.0 라이센스, 환경변수 분리, 대량 삭제 병렬화, update.sh 자동 감지
- **v1.2.0~v1.3.x** (2026-05): README 풀 리뉴얼, Drive 자동 동기화, 자동 업데이트 알림
- **v1.0.0** (2026-05): NAI v4.5 검증 후 첫 정식 출시
- **v1.0.0 이전** (2026-04~05): 인프라 구축, UI 이식, 큐 시스템

---

## 라이센스 / 크레딧

본 프로젝트는 **PolyForm Noncommercial 1.0.0** 라이센스로 배포됩니다. 자세한 내용은 [LICENSE](LICENSE)를 보세요.

한국어 해석 가이드는 [LICENSE-INTERPRETATION.md](LICENSE-INTERPRETATION.md)에서 확인 가능 (법적 효력은 LICENSE 영문 본문 우선).

### 한 줄 요약

**개인이 자기 NAI 계정으로 자기 서버에 운영하는 건 환영합니다. 영리 목적 사용은 안 됩니다.**

- ✅ 개인 사용, fork, 수정, 자기 서버 운영, 친구/가족과 비영리 공유
- ✅ 취미·학습·연구·교육 기관 사용 (PolyForm "Noncommercial Organizations")
- ❌ 상업적 호스팅 서비스, 회사 내부 도구, 유료 앱 재포장, 광고 수익 통합
- ⚠ 저작자 표시(`Required Notice: Copyright Minkyung`)와 LICENSE 동봉 의무

### 라이센스 이력

- 2026-05-10 이전: CC BY-NC-ND 4.0 ([LICENSE-CC-OLD](LICENSE-CC-OLD)에 보존)
- 2026-05-10부터 (v1.4.0): **PolyForm Noncommercial 1.0.0**

CC 라이센스는 코드용으로 부적절하고 ND 조항이 fork 권장 워크플로우와 충돌해서 변경했습니다.

### 크레딧

- **원작**: [Dd154663/SDStudio](https://github.com/Dd154663/SDStudio) (MIT) — Electron 데스크톱 앱
- **원원작**: [sunho/SDStudio](https://github.com/sunho/SDStudio) (MIT) — 프론트엔드 원본
- **본 fork (서버 이식 + 운영 안정화)**: [danso0429/nai-studio](https://github.com/danso0429/nai-studio) (PolyForm Noncommercial 1.0.0)

원본 MIT 부분의 attribution은 [LICENSE-NOTICES.md](LICENSE-NOTICES.md)를 보세요.

### 기여

피드백·이슈 환영합니다. PR 보내시는 분은 본인 기여가 PolyForm Noncommercial 1.0.0 하에 라이센스됨을 동의하는 것으로 간주합니다.

이슈, 버그 리포트, 기능 제안은 [GitHub Issues](https://github.com/danso0429/nai-studio/issues)로 부탁드립니다.
