# SDStudio Remote

[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/License-PolyForm_NC_1.0.0-blue.svg)](https://polyformproject.org/licenses/noncommercial/1.0.0)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-Linux-FCC624?logo=linux&logoColor=black)](https://ubuntu.com/)

[SDStudio](https://github.com/Dd154663/SDStudio) (Electron 데스크톱 앱)를 **웹 서버**로 이식한 프로젝트입니다. 자기 서버에 한 번 설치하면 PC·태블릿·스마트폰에서 브라우저로 접속해 NovelAI 이미지 생성을 사용할 수 있습니다. 이미지 생성은 서버에서 처리되므로 브라우저를 닫아도 대량 생성이 멈추지 않습니다.

> 이 프로젝트는 [Dd154663/SDStudio](https://github.com/Dd154663/SDStudio)의 fork이며, 원작 [sunho/SDStudio](https://github.com/sunho/SDStudio)에서 파생된 프론트엔드를 사용합니다.

![메인 화면](https://raw.githubusercontent.com/Dd154663/SDStudio/main/images/img1.png)

---

## 목차

- [주요 기능](#주요-기능)
- [SDStudio PC 버전과의 차이점](#sdstudio-pc-버전과의-차이점)
- [설치 방법](#설치-방법)
- [업데이트 방법](#업데이트-방법)
- [고급 설정 (선택)](#고급-설정-선택)
- [변경 이력](#변경-이력)
- [라이센스 / 크레딧](#라이센스--크레딧)

---

## 주요 기능

SDStudio PC 버전의 모든 핵심 기능을 웹에서 사용할 수 있고, 웹 환경에 맞춘 추가 기능도 있습니다.

### 🎨 씬 별 이미지 생성
프리셋(상위/하위/네거티브 프롬프트)과 씬(중간 프롬프트)을 조합해 캐릭터 에셋을 대량 생성합니다.

![씬 별 이미지 생성](https://raw.githubusercontent.com/Dd154663/SDStudio/main/images/img3.png)

### 🏆 이미지 월드컵
생성된 이미지들을 토너먼트로 비교해 최고를 선별합니다.

![이미지 월드컵](https://raw.githubusercontent.com/Dd154663/SDStudio/main/images/img8.png)

### 🖌️ 인페인팅
이미지의 특정 부분만 마스크로 선택해 다시 생성합니다.

![인페인팅](https://raw.githubusercontent.com/Dd154663/SDStudio/main/images/img4.png)

### ✂️ 배경 제거 / 🔤 태그 자동완성 / 🧩 프롬프트 조각 / 🔀 이미지 변형 (img2img)
SDStudio PC 버전의 기능 그대로 지원합니다.

### 🌐 웹 전용 추가 기능
- **서버 측 큐**: 브라우저를 닫아도 서버가 대량 생성을 계속함
- **어디서든 접속**: Tailscale로 PC·모바일 어디서든
- **NAI v4 / v4.5 완전 지원**: 멀티 캐릭터 프롬프트, 캐릭터 레퍼런스, 바이브 트랜스퍼
- **자동 업데이트 알림**: 새 버전 출시 시 화면 우측 상단/모바일 알약에 표시
- **선택 기능**: Google Drive 자동 동기화 (이미지 내보내기 결과 보존)

---

## SDStudio PC 버전과의 차이점

> 기준: SDStudio Remote **v1.2.0** (SDStudio v4.7.1 기반)

| 항목 | SDStudio PC (v4.7.1) | SDStudio Remote |
| --- | --- | --- |
| **실행 방식** | Electron 데스크톱 앱 | Node.js 서버 + 브라우저 접속 |
| **설치 위치** | 사용자 PC | 자기 서버 (Linux 권장) |
| **이미지 저장** | 사용자 PC 로컬 디스크 | 서버 디스크 (`data/outs/`) |
| **다운로드 흐름** | 자동으로 사용자 폴더에 저장 | Google Drive 동기화 (선택) 또는 단일 이미지 다운로드 버튼 |
| **이미지 생성 큐** | 브라우저 닫으면 중단 | 서버 측 큐, 브라우저 닫아도 계속 |
| **여러 기기 접속** | 불가 (PC 1대) | PC + 모바일 동시 접속 가능 |
| **다중 사용자** | 불가 (Electron 단일 사용자) | 단일 사용자 가정 (인증 미구현) |
| **파일 시스템 접근** | 무제한 (네이티브) | API 통한 sandbox (`data/` 하위만) |
| **NAI 토큰 저장** | OS keychain 또는 설정 | `data/TOKEN.txt` 평문 (서버 디스크) |
| **업데이트 방식** | 앱이 자동 감지 + 사용자 클릭 | `./update.sh` 수동 실행 (자동 알림 포함) |
| **태그 DB (Danbooru)** | 앱 내장 | `data/db.csv` 별도 배치 |
| **백업** | 사용자가 폴더 복사 | 자동 동기화 (선택, rclone) |
| **AVIF 최적화** | 미지원 | 지원 (모바일 데이터 절약) |
| **이미지 썸네일 캐시** | 매번 재생성 | 서버에서 prewarm (200/400/500px) |

### 미이식 / 미지원 기능

| 기능 | 상태 | 이유 |
| --- | --- | --- |
| Windows 네이티브 단축키 | 미지원 | 브라우저 기반이라 OS 단축키 충돌 회피 |
| 클립보드 이미지 직접 붙여넣기 | 부분 지원 | 브라우저 권한에 따라 동작 차이 |
| `bin/` 외부 도구 통합 (PC SDStudio 8.9GB) | 미이식 | 서버 디스크 부담, 사용 빈도 낮음 |
| 다중 사용자 / 인증 | 미지원 | 본인 서버 + Tailscale로 접근 제한 가정 |

> 이 표는 **버전이 올라갈 때마다 갱신**됩니다. 새 기능 추가 또는 미이식 항목 변경 시 PR 환영합니다.

---

## 설치 방법

서버에 한 번 설치하고, 이후엔 PC/모바일 브라우저로 접속해 사용합니다.

### 사전 요구 사항

- **Linux 서버** (Ubuntu 22.04+ 권장, ARM64도 지원)
- **Node.js 18 이상**
- **NovelAI 계정** (이미지 생성 토큰 발급용)

> 무료 서버가 필요하면 Oracle Cloud Always Free, AWS Free Tier 등의 ARM 인스턴스를 추천합니다. 설치 가이드는 인터넷에서 쉽게 찾을 수 있습니다.

### 1. Node.js 설치

Ubuntu/Debian:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential
node --version  # v20.x.x 확인
```

다른 OS는 [nodejs.org](https://nodejs.org/) 참고.

### 2. SDStudio Remote 설치

```bash
# 클론
git clone https://github.com/danso0429/nai-studio.git
cd nai-studio

# 의존성 설치
npm install
cd frontend && npm install && cd ..

# 프론트엔드 빌드
cd frontend && npx vite build --emptyOutDir && cd ..
```

### 3. NovelAI 토큰 설정

1. [novelai.net](https://novelai.net) 로그인
2. 좌측 상단 거위 아이콘 → **Account Settings**
3. **Get Persistent API Token** 클릭, 복사
4. 서버에 저장:
```bash
mkdir -p data
echo "여기에_토큰_붙여넣기" > data/TOKEN.txt
chmod 600 data/TOKEN.txt
```

또는 토큰 없이 시작하고 웹 UI 환경설정에서 이메일/비밀번호로 로그인할 수도 있습니다.

### 4. 서버 실행

**개발/단발성 실행**:
```bash
node server.js
# http://localhost:6247
```

**상시 운영 (권장)**: pm2로 백그라운드 + 자동 재시작:
```bash
sudo npm install -g pm2
pm2 start server.js --name nai-studio
pm2 save
pm2 startup  # 시스템 재부팅 시 자동 시작
```

### 5. 외부 접속 설정 (Tailscale 권장)

집 밖이나 모바일에서 접속하려면 [Tailscale](https://tailscale.com/) 추천 (무료, 사설 VPN):

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# HTTPS로 노출 (인증 자동, Let's Encrypt 불필요)
sudo tailscale serve --bg --https=443 --set-path=/studio http://localhost:6247
```

이제 `https://your-host.tailNNNNN.ts.net/studio`로 어디서든 접속 가능. Tailscale 계정으로 로그인된 기기에서만 접근됩니다.

> ### ⚠️ 보안 주의사항 (꼭 읽어주세요)
>
> 본 서버는 **인증 미들웨어가 없습니다.** 누구나 접근 가능한 환경에 노출하면 다음과 같은 위험이 있습니다:
>
> - **NAI 토큰 탈취**: `POST /api/auth/login-token`으로 누구든 본인 계정 토큰을 덮어쓸 수 있음
> - **Anlas 크레딧 무단 소진**: 큐 API에 인증이 없어 누구든 본인 계정으로 이미지 생성 가능
> - **데이터 삭제**: 프로젝트/이미지 파일을 누구든 삭제 가능
>
> **반드시 Tailscale tailnet, WireGuard, 또는 동등한 사설망 전용으로만 운영하세요.** 위 `tailscale serve`는 tailnet 전용(인증된 본인 기기만)이므로 안전합니다.
>
> 만약 인터넷에 직접 노출(Tailscale Funnel, nginx 공개, 0.0.0.0 바인딩 등)하려면 다음 중 *반드시* 하나를 적용하세요:
> - nginx 또는 caddy의 basic auth/OAuth proxy 추가
> - Authelia, Keycloak 같은 인증 게이트웨이 통합
> - 이 프로젝트에 직접 인증 미들웨어 추가 (현재 코드에 없음)
>
> NAI 계정과 결제 정보 탈취로 이어질 수 있는 사안이라 가볍게 보지 마세요.

### 6. 태그 자동완성 활성화 (선택)

Danbooru 태그 DB(`db.csv`)를 `data/`에 두면 자동완성이 활성화됩니다. 파일은 SDStudio PC 버전에 포함된 것을 그대로 사용 가능.

```bash
cp /path/to/sdstudio/db.csv data/db.csv
```

### 7. SDStudio PC 데이터 이전 (선택)

기존 SDStudio PC 사용자라면 프리셋과 바이브를 가져올 수 있습니다.

Windows SDStudio 데이터 위치: `%APPDATA%\SDStudio\SDStudio\`

복사할 폴더:
- `projects/` → `data/projects/` (프리셋, 씬)
- `vibes/` → `data/vibes/` (바이브 이미지)
- `inpaints/` → `data/inpaints/` (인페인팅)
- `config.json` → `data/config.json` (설정)

---

## 업데이트 방법

새 버전이 출시되면 화면 우측 상단(PC) 또는 알약(모바일)에 **🔄 업데이트** 표시가 뜹니다.

### 자동 알림으로 업데이트

화면의 알림을 클릭하면 모달이 열리며, 안에 표시된 명령을 서버에서 실행하세요:

```bash
cd ~/nai-studio && ./update.sh
```

`update.sh`가 다음을 자동 처리합니다:
1. GitHub에서 최신 코드 pull
2. `npm install`로 의존성 갱신
3. 프론트엔드 재빌드
4. pm2로 서버 재시작 (pm2 사용 시) — 또는 수동 재시작 안내

**데이터(프리셋, 이미지, 설정)는 그대로 유지됩니다.**

### 수동 확인

```bash
cd ~/nai-studio
git fetch
git log HEAD..origin/main --oneline   # 새 커밋 확인
./update.sh                           # 업데이트
```

### 처리 중인 작업이 있으면

`update.sh`는 큐에 대기 중인 이미지가 있으면 경고합니다. 큐를 비우고 업데이트하거나, 강제 진행할지 선택할 수 있습니다.

---

## 고급 설정 (선택)

### Google Drive 자동 동기화 (rclone)

이미지 내보내기 결과(`data/exports/`)를 Google Drive에 자동 업로드하면 서버 디스크가 가득 차도 안전합니다.

#### 1. rclone 설치 및 인증
```bash
curl https://rclone.org/install.sh | sudo bash
rclone config
# 안내 따라서: New remote → name: gdrive → Storage: drive (Google Drive)
# OAuth 흐름은 브라우저에서 진행
```

#### 2. 동기화 스크립트 작성
```bash
cat > ~/sync_naistudio.sh << 'SHEOF'
#!/bin/bash
LOG="$HOME/sync_naistudio.log"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 동기화 시작" >> "$LOG"

# 작업 데이터: 미러링
rclone sync ~/nai-studio/data/ gdrive:NAI-Studio/data/ \
  --exclude "tmp/**" \
  --exclude "exports/**" \
  --exclude "**/fastcache/**" \
  --exclude "**/.trash/**" \
  --log-file="$LOG" --log-level INFO

# exports/: append-only (로컬에서 지워져도 Drive는 보존)
rclone copy ~/nai-studio/data/exports/ gdrive:NAI-Studio/data/exports/ \
  --log-file="$LOG" --log-level INFO

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 동기화 완료" >> "$LOG"
SHEOF
chmod +x ~/sync_naistudio.sh
```

#### 3. 30분마다 자동 실행 (cron)
```bash
crontab -e
# 추가:
*/30 * * * * ~/sync_naistudio.sh
```

이미지 내보내기 시점에는 즉시 동기화되며, 그 외 데이터는 30분마다 백업됩니다.

### 디스크 자동 정리

`server.js`에 디스크 부족 자동 cleanup 로직이 내장되어 있습니다.
- **Stage 1** (디스크 5GB 미만): `tmp/`, `exports/` 7일+ 삭제
- **Stage 2**: 30일+ outs 이미지 정리
- **Stage 3**: 큐 일시정지 + 알림
- **Stage 4** (Drive 백업 활성 시): Drive에 이미 있는 파일 로컬 삭제

설정은 `server.js` 상단의 `DISK_*` 상수에서 조정.

### 빌드 정보 확인

```bash
curl -s localhost:6247/api/build-info | python3 -m json.tool
# {"buildTime": "...", "gitHash": "...", "version": "1.2.0", "sdstudioBase": "4.7.1"}
```

---

## 변경 이력

전체 변경 이력은 [CHANGELOG.md](CHANGELOG.md)를 참고하세요.

**최근 변경 (요약)**:
- **v1.2.0+** (Phase 6 마무리, 2026-05): README 풀 리뉴얼, CHANGELOG 자동 갱신
- **v1.1.x** (Phase 6, 2026-05): Drive 자동 동기화, 알약 scene 표시, 자동 업데이트 알림
- **v1.0.0** (Phase 5, 2026-05): NAI v4.5 검증 후 첫 정식 출시 — 바이브, 캐릭터 레퍼런스, 멀티 캐릭터 프롬프트 모두 동작 확인
- **v1.0.0 이전** (Phase 1~4, 2026-04~05): 인프라 구축, UI 이식, 큐 시스템, 자동 배포

---

## 라이센스 / 크레딧

본 프로젝트는 **PolyForm Noncommercial 1.0.0** 라이센스로 배포됩니다. 자세한 내용은 [LICENSE](LICENSE) 파일을 보세요.

한국어 해석 가이드는 [LICENSE-INTERPRETATION.md](LICENSE-INTERPRETATION.md)에서 확인할 수 있습니다 (법적 효력은 LICENSE 영문 본문이 우선).

### 한 줄 요약

**개인이 자기 NAI 계정으로 자기 서버에 운영하는 건 환영합니다. 영리 목적으로 가져다 쓰는 건 안 됩니다.**

- ✅ 개인 사용, fork, 수정, 자기 서버 운영, 친구/가족과 비영리 공유
- ✅ 취미·학습·연구·교육 기관 사용 (PolyForm "Noncommercial Organizations")
- ❌ 상업적 호스팅 서비스, 회사 내부 도구, 유료 앱 재포장, 광고 수익 통합
- ⚠ 저작자 표시(`Required Notice: Copyright Minkyung`)와 LICENSE 동봉 의무

### 라이센스 이력

- 2026-05-10 이전: CC BY-NC-ND 4.0 ([LICENSE-CC-OLD](LICENSE-CC-OLD)에 보존)
- 2026-05-10부터 (v1.4.0): **PolyForm Noncommercial 1.0.0**

CC 라이센스는 코드용으로 부적절하고 ND(파생물 금지) 조항이 fork 권장 워크플로우와 충돌하기에 변경했습니다.

### 크레딧

- **원작**: [Dd154663/SDStudio](https://github.com/Dd154663/SDStudio) (MIT) — Electron 데스크톱 앱
- **원원작**: [sunho/SDStudio](https://github.com/sunho/SDStudio) (MIT) — 프론트엔드 원본
- **본 fork (서버 이식 + Phase 7 개선)**: [danso0429/nai-studio](https://github.com/danso0429/nai-studio) (PolyForm Noncommercial 1.0.0)

원본 MIT 부분의 attribution은 [LICENSE-NOTICES.md](LICENSE-NOTICES.md)를 보세요.

### 기여

기여는 환영합니다. 하지만 PR을 보내시는 분은 본인의 기여가 PolyForm Noncommercial 1.0.0 하에 라이센스됨을 동의하는 것으로 간주합니다.

이슈, 버그 리포트, 기능 제안은 [GitHub Issues](https://github.com/danso0429/nai-studio/issues)로 부탁드립니다.
