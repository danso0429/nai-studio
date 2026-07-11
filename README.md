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
- [큐 진행 상황 페이지](#큐-진행-상황-페이지-queue)
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

> Drive를 설정하지 않으면 백업·동기화 관련 기능만 자동으로 꺼지고, 나머지는 그대로 동작해요.

### 🎨 SDStudio PC 버전의 핵심 기능 그대로

- **씬별 이미지 생성** — 프리셋 + 씬 조합으로 캐릭터 이미지 대량 생성
- **이미지 월드컵** — 생성된 이미지를 토너먼트로 선별
- **인페인팅** — 마스크로 일부분만 다시 생성
- **이미지 변형 (img2img)** — 기존 이미지를 베이스로 다른 버전 생성
- **배경 제거** — 클릭 한 번으로 배경 투명 처리
- **태그 자동완성** — 입력하면 태그 자동 추천
- **프롬프트 조각** — 자주 쓰는 프롬프트 블록 저장/조립
- **NAI v4 / v4.5 완전 지원** — 멀티 캐릭터, 캐릭터 레퍼런스, 바이브 트랜스퍼
- **캐릭터 프리셋** — 카드 목록 + 대표 이미지 + 상세 설정. 여러 캐릭터를 한 번에 적용, 프리셋 × 씬 자동 순회 생성, 프리셋 내보내기/불러오기
- **그림체 글로벌 프리셋 라이브러리** — 그림체(글로벌) 프리셋을 카드 그리드 한 곳에 모아 검색·정렬·편집(프롬프트·샘플링·대표 이미지). 적용 시 현재 모드(이지/일반)로 자동 변환, NAI 생성 이미지의 메타데이터에서 프롬프트를 추출해 가져오기
- **프로젝트 브라우저** — 카드 그리드로 프로젝트 탐색(썸네일·검색·즐겨찾기), 다른 프로젝트로 씬 복사
- **트루 다크 모드** — 순수 검정 배경 (다크/트루 다크/화이트 3택)
- **프롬프트 chunk** — 자주 쓰는 태그 묶음을 이름 붙여 저장. 프롬프트 칸에 알약으로 넣으면 생성할 때 펼쳐짐. 호버하면 내용 미리보기. 캐릭터 프롬프트 칸에도 사용 가능
- **샘플링 프리셋** — 스텝/가이던스/샘플러 같은 설정을 이름 붙여 저장하고 적용/해제
- **조합 에디터** — 슬롯을 드래그로 자유 배치 + 충돌하는 태그를 묶어 버튼으로 on/off
- **프롬프트 찾기** — 검색창에서 씬 이름 + 프롬프트 칸 태그를 형광 강조, 다음/이전으로 이동

### 🌐 웹/모바일 전용 추가 기능

- **🖥️ 서버가 대신 처리** — 브라우저 닫아도, 폰 꺼도 서버가 계속 이미지 생성. 다시 열면 진행 상태 그대로
- **📱 어디서든 접속** — PC·모바일에서 같은 서버에 접근
- **🔄 자동 업데이트** — 새 버전이 나오면 화면에 표시. 한 번 클릭으로 업데이트 (SSH 같은 거 몰라도 됨)
- **📊 진행 상황 한눈에** — 진행률 + 예상 남은 시간. 클릭하면 폴더/프로젝트/씬별 트리로 확인하고, 급한 건 우선 처리(⭐)
- **🎚️ 개수 조절** — ◀▶ 버튼이나 직접 입력으로 생성 장수 조절
- **📁 폴더로 정리** — 프로젝트를 폴더로 분류, **폴더 안에 폴더**(중첩)까지 트리로. ⋮ 메뉴에서 폴더 이동·다른 폴더로 복사(이미지 포함)
- **🗂️ 내보내기 설정 저장** — 자주 쓰는 내보내기 방식(전체/즐겨찾기, 형식, 크기)을 저장해두고 다이얼로그 없이 한 번에
- **📂 폴더 통째로 내보내기** — 폴더 안 모든 프로젝트를 한 번에
- **💾 백업/복원** — 폴더 단위로, 또는 전체 데이터(프로젝트·프리셋·설정)를 zip 하나로 백업하고 복원. 복원 시 이름이 같은 프로젝트는 새 이름으로(또는 건너뛰기/덮어쓰기), 프리셋 등 설정은 병합(현재 유지 + 백업의 새 항목 추가)
- **☁️ Google Drive 자동 백업 (선택)** — 설정하면 내보낸 이미지가 자동으로 Drive에 올라감 (안 해도 됨, 실패해도 알아서 재시도)
- **⏸️ 큐 일시정지/재개** — 생성 중 멈췄다가 이어서. 서버를 재시작해도 큐가 유지됨
- **🖱️ 이미지 여러 장 선택** — 데스크탑은 Ctrl로 선택 모드를 켜고(다시 누르면 끔) 클릭으로 여러 장 선택. 다른 씬·프로젝트로 옮기거나 복사
- **🗑️ 한 번에 정리** — 프로젝트·이미지 일괄 삭제, 디스크 정리
- **🗂️ 프로젝트별 저장 공간** — 어느 프로젝트가 용량을 많이 쓰는지(이미지 포함) 확인하고 정리 (환경설정 → 저장경로)
- **📥 여러 프로젝트 한 번에 가져오기** — 파일 여러 개를 드래그하면 한꺼번에 가져옴
- **➕ 씬/조합 단위 네거티브** — 프리셋 전체뿐 아니라 씬·조합마다 따로 네거티브 지정
- **🔍 태그 검색** — db.csv 태그를 검색해 학습량(빈도)순으로 보고, 태그를 눌러 바로 복사 (상단 태그 검색 탭)
- **📱 모바일 프롬프트 자동 확대** — 프롬프트 칸을 탭하면 큰 편집 화면으로 확대 + 태그 자동완성이 전용 영역에 (모바일에서 자동완성 창이 어긋나던 문제 해소)
- **🎨 작가 라이브러리** — 자주 쓰는 작가/스타일을 이미지·메모와 함께 저장·검색, danbooru 검색 버튼
- **📲 홈 화면 앱 새로고침 복구** — iOS에서 홈 화면에 추가해 쓸 때, 다른 앱을 오래 쓰다 돌아오면 새로고침되며 처음 화면으로 튕기던 것을 → 마지막 프로젝트와 탭으로 자동 복귀 (새로고침은 iOS 메모리 관리라 못 막지만 하던 자리로 되돌림)
- **🛡️ 데이터 보호** — 폴더만 삭제할 때 프로젝트 이동이 하나라도 실패하면 영구 삭제를 중단하고, 전역 프리셋·조각 등은 네트워크 읽기 실패를 빈 데이터로 오인해 덮어쓰지 않도록 저장 차단

---

## SDStudio PC 버전과의 차이점

> SDStudio PC(데스크톱 앱)와 비교해 달라진 점이에요.

| 항목 | SDStudio PC | SDStudio Remote |
| --- | --- | --- |
| **실행 방식** | 데스크톱 앱 | 서버 + 브라우저 접속 |
| **설치 위치** | 사용자 PC | 자기 서버 (Linux 권장) |
| **여러 기기 접속** | 불가 (PC 1대) | PC + 모바일 동시 접속 |
| **다중 사용자** | 불가 | 단일 사용자 가정 (사설망 전제) |
| **NAI 토큰 저장** | OS keychain 또는 설정 | 서버에 평문 저장 (사설망 전제) |
| **이미지 큐** | 브라우저 닫으면 중단 | 서버가 계속 처리, 닫았다 열면 자동 동기화 |
| **큐 유지** | 미지원 | 서버를 재시작해도 보존, 유실분 자동 재예약 |
| **큐 예상 시간** | 단순 평균 | 시간대별 속도를 반영해 더 정확 |
| **씬 자동 갱신** | 앱 자체 처리 | 실시간 자동 갱신 (연결 끊겨도 자동 복구) |
| **진행 상황 표시** | 모달 다이얼로그 | 상단 진행 알약 + 폴더/프로젝트/씬 트리 |
| **업데이트** | 앱이 자동 감지 + 클릭 | 앱에서 한 번 클릭 (또는 SSH 명령) |
| **백업** | 사용자가 폴더 복사 | Google Drive 자동 동기화 (선택) |
| **백업/복원** | 수동 폴더 복사 | 폴더 단위 + 전체 데이터(프리셋·설정 포함)를 서버측에서 zip 백업·복원 (동명은 새 이름, 설정은 병합) |
| **이미지 다운로드** | OS 다이얼로그 → 폴더 선택 | 한 번 클릭 → Drive 자동 (미사용 시 브라우저) |
| **내보내기** | 매번 옵션 선택 | 설정 저장 후 한 번 클릭, 여러 프로젝트 동시 |
| **프로젝트 폴더 분류** | 폴더 없음 | 폴더로 분류, 폴더 안에 폴더(중첩, 최대 깊이 3) 트리 |
| **작가 라이브러리** | 없음 | 작가/스타일을 이미지·메모와 저장·검색, danbooru 검색 |
| **태그 검색** | 없음 | db.csv 태그 검색 + 학습량순 + 눌러서 복사 (전용 탭) |
| **모바일 프롬프트 편집** | (데스크톱 앱) | 칸을 탭하면 자동 확대 + 태그 자동완성 전용 영역 |
| **홈 화면 앱(PWA) 복귀** | (데스크톱 앱) | iOS에서 백그라운드 후 새로고침돼도 마지막 프로젝트·탭 자동 복원 |
| **폴더 삭제·전역 데이터 보호** | 로컬 앱 파일 작업 | 폴더 보존 삭제를 서버에서도 검증 + 불확실한 전역 데이터 읽기 오류 시 원본 저장 차단 |
| **AVIF 최적화** | 미지원 | 지원 (모바일 데이터 절약) |
| **커스텀 해상도** | 모달 1개 | 한 폼에 가로/세로 동시 입력 + 자동 보정 |
| **테마** | 다크 / 화이트 | 다크 / 트루 다크 / 화이트 3택 |
| **프롬프트 chunk** | 없음 | 자주 쓰는 태그 묶음 알약(생성 시 펼침) + 샘플링 프리셋, 캐릭터 칸에도 |
| **네거티브 자동완성** | 메인 네거티브만 | 조합·씬 전용 네거티브 칸에도 자동완성 |
| **조합 에디터** | 기본 슬롯 조합 | 슬롯 자유 드래그 + 충돌 태그 묶어 on/off |
| **프롬프트 찾기** | 없음 | 씬 이름 + 프롬프트 태그 형광 강조, 다음/이전 이동 |
| **씬 결과 화면** | 기본 | Ctrl로 선택 모드 토글 후 클릭으로 다중 선택, 제목 클릭 이름 편집, 다른 씬으로 이미지 이동 |
| **씬 복사** | 다른 프로젝트로 복사 | 동일 + 대상 프로젝트를 폴더별 목록에서 선택 |
| **디스크 정리** | 수동 | 앱 안에서 종류별 선택 삭제 |

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

- **리눅스 서버** (Ubuntu 22.04+, ARM64 OK. 2 CPU / 12 GB RAM 이상 권장)
  - 무료로는 **Oracle Cloud Always Free**의 ARM Ampere A1 추천 (4 vCPU + 24GB RAM, 이 프로젝트가 실제 돌아가는 환경). [아카라이브 오라클 가이드](https://arca.live/b/characterai/137016430) 참고.
  - 단 그 가이드의 **RisuAI 설치·HTTPS 인증서 단계는 SKIP**하세요 (아래 Tailscale이 대신함). 보안 규칙은 **22(SSH)만 임시로** 열면 되고, 나머지(80/443/6247)는 안 열어도 돼요 (Tailscale로만 접근).
- **NovelAI 계정** + Persistent API Token (받는 법은 Step 3)
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

다른 경로/포트 원하면 `setup.sh` 전에 `nano .env.local` 편집(기본값 `PORT=6247`, `URL_PREFIX=/studio`). 다시 돌려도 안전해요(기존 설정 보존).

<details>
<summary>setup.sh 안 쓰고 수동으로 하려면 펼치기</summary>

```bash
cd ~ && git clone https://github.com/danso0429/nai-studio.git && cd nai-studio
cp .env.example .env.local
npm install
(cd frontend && npm install && npx vite build --emptyOutDir)
```
</details>

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

> 자산이 404로 안 뜨면 `.env.local`의 `URL_PREFIX`와 `VITE_BASE_PATH`가 안 맞는 거예요. 맞춰서 재빌드(`cd frontend && npx vite build && cd ..`) + 서버 재시작.

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

> 경로(`/studio`)를 다른 걸로 바꿨으면 `tailscale serve --set-path` / `.env.local`의 `URL_PREFIX` / `VITE_BASE_PATH` 셋을 같게 맞추고 재빌드하세요. 기본값이면 그대로 둬도 돼요.

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
> Tailscale이 잘 동작하면 SSH도 Tailscale로 접근 가능해서, Oracle 보안 그룹의 외부 포트(22/80/443/6247)를 다 닫아도 돼요. 인터넷의 SSH 공격이 차단되고, 어차피 외부 포트는 Tailscale이 안 써서 동작에 영향 없어요.
>
> **순서 (꼭 이 순서로!)**:
> 1. Tailscale 설치 후 SSH로 접속 테스트: `ssh ubuntu@<호스트명>.tailNNNNN.ts.net`
> 2. SSH 접속 + 브라우저(`https://<호스트명>.tailNNNNN.ts.net/studio`) 둘 다 잘 되는지 확인
> 3. Oracle Cloud 보안 그룹에서 22 / 80 / 443 / 6247 수신 규칙 전부 삭제
>
> ⚠️ **Tailscale SSH가 되는 걸 확인하기 전에 22번을 닫으면 서버에 영영 못 들어가요.** 꼭 확인 후 닫으세요. (다른 서비스를 같이 운영하면 그 포트만 열어두세요.)

### Step 7. SDStudio PC 데이터 이전 (선택)

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

## 큐 진행 상황 페이지 (`/queue`)

본 서버에 자동으로 같이 설치돼요. 별도 설치 X. 메인 페이지 옆에 다음 URL로 접속:

- `https://your-host.tailNNNNN.ts.net/studio/queue`
- 또는 (메인이 `/`에 있으면) `http://localhost:6247/queue`

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
서버가 자동으로 5초 대기 후 10회 재시도해요. 그래도 실패면 큐 페이지(`/queue`)의 "최근 NAI 큐 에러" 섹션에 기록됩니다.

### Q. 업데이트 알림이 안 사라져요
`update.sh` 실행 후에도 알림 그대로면 브라우저 캐시 새로고침 (모바일은 새로고침 + 캐시 비우기). 또는 `curl localhost:6247/api/build-info`로 현재 버전 확인.

### Q. iOS Safari에서 이미지 내려받기가 새 탭으로 열려요
v1.5.3부터 단일 이미지 "다운로드" 버튼은 Drive 가용 시 자동으로 Drive에 올려요(다이얼로그 없음). Drive에서 받으세요. Drive 미사용 환경에선 브라우저 직접 다운로드(`<a download>`)로 fallback — iOS 13+는 정상 다운로드, 새 탭 열리는 옛 케이스는 거의 없어요.

---

## 변경 이력

세부 변경 이력은 **[CHANGELOG.md](CHANGELOG.md)** 를 봐주세요 (모든 버전 기록).

**최근 주요 변경**:

- **v1.11** — SDStudio 4.10→4.13.5 통합(글로벌 프리셋 통합·전체 백업/복원·중첩 폴더·작가 라이브러리·태그 검색·모바일 프롬프트 확대) + iOS 홈 화면 앱 콜드 리로드 프로젝트·탭 복원. v1.11.4 전체 진단으로 폴더 보존 삭제·전역 JSON 읽기 실패 데이터 유실 차단, dependency DoS 해소, 태그 검색 고속화.
- **v1.10** — 코드베이스 전체 점검 릴리즈(안정성·견고성 20건, 전부 동작 보존). 큐 취소 시 다음 작업 손실·프로젝트 이름변경 후 편집 손실·다이얼로그 떠있을 때 프로젝트 전환 오적용·큐 상태 파일 손상 무음 손실 등 데이터 손실 경로 차단 + NAI 응답 hang 타임아웃·압축 해제 경로 검증(Zip Slip)·백업 zip 토큰 제외 등 견고성/보안. 씬 일괄 등록 백그라운드 전송(실험·기본 꺼짐) + 폴더 드로어 앱 백업/복원 진입.
- **v1.9** — 프롬프트 chunk(태그 묶음 알약, 생성 시 펼침) + 샘플링 프리셋. 조합 에디터 드래그 + 씬 토글 그룹. 프롬프트 찾기. 캐릭터 칸 chunk + 네거티브 자동완성. 씬 결과 화면 Ctrl 선택·제목 클릭 편집·다른 씬으로 이미지 이동. **SDStudio v4.10.0 흡수(좌측 슬라이드 폴더 드로어 UI·폴더 색상/즐겨찾기·프로젝트 복제·글로벌 캐릭터 프리셋) + 대량 작업 백그라운드화(이미지 일괄삭제·폴더삭제) + 큐 예약 orphan 자동복구**
- **v1.8** — 큐 예약(새로고침해도 유지)·폴더 백업/복원·한 번에 큐 등록·디스크 정리. SDStudio v4.9.0 흡수(캐릭터 프리셋 다중, 프로젝트 브라우저, 트루 다크 모드)
- **v1.7** — 자동 업데이트(UI 한 클릭). 다중 프로젝트 내보내기. 안정성 대규모 개선
- **v1.6** — SDStudio v4.8.0 흡수(캐릭터 프리셋 개편, 순차 생성)
- **v1.5** — 폴더 시스템·폴더 백업. 서버 큐 통합(폰 닫아도 진행). 보안 강화. 느린 네트워크 최적화
- **v1.0 ~ v1.4** — 첫 정식 출시(NAI v4.5 검증), Drive 동기화, 라이센스 정립, 기본 인프라

---

## 라이센스 / 크레딧

본 프로젝트는 **PolyForm Noncommercial 1.0.0** 라이센스로 배포됩니다. 자세한 내용은 [LICENSE](LICENSE)를 보세요.

한국어 해석 가이드는 [LICENSE-INTERPRETATION.md](LICENSE-INTERPRETATION.md)에서 확인 가능 (법적 효력은 LICENSE 영문 본문 우선).

### 한 줄 요약

**개인이 자기 NAI 계정으로 자기 서버에 운영하는 건 환영합니다. 영리 목적 사용은 안 됩니다.**

- ✅ 개인 사용, fork, 수정, 자기 서버 운영, 친구/가족과 비영리 공유
- ✅ 취미·학습·연구, 비영리 조직(교육기관·공공연구기관·자선단체·정부기관 등) 사용 — PolyForm "Noncommercial Organizations" 조항 (자금 출처 무관)
- ❌ 영리 기업의 업무용 사용, 상업적 호스팅 서비스, 유료 앱 재포장, 광고 수익 통합
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
