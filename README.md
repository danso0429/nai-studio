# NAI Studio

[![License: CC BY-NC-ND 4.0](https://img.shields.io/badge/License-CC_BY--NC--ND_4.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-nd/4.0/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-Linux-FCC624?logo=linux&logoColor=black)](https://ubuntu.com/)

[SDStudio](https://github.com/Dd154663/SDStudio)를 웹 서버로 이식한 프로젝트입니다. 데스크톱 앱 설치 없이 **브라우저만으로** NovelAI 이미지 생성의 모든 기능을 사용할 수 있습니다.

서버에 한 번 설치하면 PC, 태블릿, 스마트폰 등 어디서든 접속하여 작업할 수 있고, 이미지 생성은 서버 측 큐에서 처리되므로 브라우저를 닫아도 대량 생성이 중단되지 않습니다.

![메인 화면](https://raw.githubusercontent.com/Dd154663/SDStudio/main/images/img1.png)

---

## 주요 기능

SDStudio PC 버전의 핵심 기능을 모두 웹에서 사용 가능합니다.

### 🎨 씬 별 이미지 생성
프리셋(상위 프롬프트, 하위 프롬프트, 네거티브)과 씬(중간 프롬프트)을 조합하여 캐릭터 에셋을 대량 생성합니다.

![씬 별 이미지 생성](https://raw.githubusercontent.com/Dd154663/SDStudio/main/images/img3.png)

### 🏆 이미지 월드컵
생성된 이미지들을 토너먼트 방식으로 비교하며 최고의 결과물을 선별합니다.

![이미지 월드컵](https://raw.githubusercontent.com/Dd154663/SDStudio/main/images/img8.png)

### 🖌️ 인페인팅
이미지의 특정 부분만 마스크로 선택하여 다시 생성합니다.

![인페인팅](https://raw.githubusercontent.com/Dd154663/SDStudio/main/images/img4.png)

### ✂️ 배경 제거
원클릭으로 캐릭터 배경을 투명하게 제거합니다.

![배경 제거](https://raw.githubusercontent.com/Dd154663/SDStudio/main/images/img6.png)

### 🔤 태그 자동완성
Danbooru 태그 데이터베이스 기반 자동완성을 지원합니다.

![태그 자동완성](https://raw.githubusercontent.com/Dd154663/SDStudio/main/images/img10.png)

### 🧩 프롬프트 조각 및 조합
자주 쓰는 프롬프트를 조각으로 저장하고 재사용합니다. 구문 하이라이팅으로 가독성을 높입니다.

![프롬프트 조각](https://raw.githubusercontent.com/Dd154663/SDStudio/main/images/img111.png)

### 🔀 이미지 변형 (img2img)
기존 이미지를 기반으로 변형된 이미지를 생성합니다.

![이미지 변형](https://raw.githubusercontent.com/Dd154663/SDStudio/main/images/img9.png)

### 🌐 웹 전용 기능
- **서버 기반 생성**: 브라우저를 닫아도 서버에서 대량 생성이 계속됩니다
- **어디서든 접속**: Tailscale 등 VPN을 통해 외부에서도 접속 가능
- **Google Drive 동기화**: 프리셋과 생성 결과를 자동으로 클라우드에 백업
- **NAI v4 / v4.5 지원**: 최신 NovelAI Diffusion 모델, 멀티 캐릭터 프롬프트, 캐릭터 레퍼런스 지원

---

## 설치 방법

### 1. 사전 준비

**Node.js 18 이상**이 필요합니다.

Ubuntu/Debian:
```bash
# Node.js 20 LTS 설치
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 설치 확인
node --version  # v20.x.x
npm --version   # 10.x.x
```

다른 OS: [nodejs.org](https://nodejs.org/) 에서 다운로드

**sharp** (이미지 처리 라이브러리)를 빌드하기 위해 추가 패키지가 필요할 수 있습니다:
```bash
# Ubuntu/Debian
sudo apt-get install -y build-essential
```

### 2. NAI Studio 설치

```bash
# 리포지토리 클론
git clone https://github.com/danso0429/nai-studio.git
cd nai-studio

# 서버 의존성 설치
npm install

# 프론트엔드 빌드
cd frontend
npm install
npx vite build --emptyOutDir
cd ..
```

### 3. NovelAI 토큰 설정

NovelAI 계정에서 **Persistent API Token**을 발급받아야 합니다.

1. [novelai.net](https://novelai.net) 로그인
2. 좌측 상단 거위 아이콘 → Account Settings
3. "Get Persistent API Token" 클릭
4. 토큰 복사 후 아래 명령어 실행:

```bash
mkdir -p data
echo "발급받은_토큰" > data/TOKEN.txt
```

또는 NAI Studio 웹 UI에서 이메일/비밀번호로 직접 로그인할 수도 있습니다.

### 4. 서버 실행

```bash
# 직접 실행
node server.js

# 또는 pm2로 백그라운드 실행 (권장)
npm install -g pm2
pm2 start server.js --name nai-studio
pm2 save
pm2 startup  # 서버 재부팅 시 자동 시작
```

서버가 시작되면 **http://localhost:6247** 에서 접속할 수 있습니다.

### 5. 외부 접속 설정 (선택)

로컬 네트워크 밖에서 접속하려면 [Tailscale](https://tailscale.com/)을 추천합니다:

```bash
# Tailscale 설치 (무료)
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# HTTPS 서빙 설정
sudo tailscale serve --bg 6247
```

이제 `https://your-hostname.tail*****.ts.net` 으로 어디서든 접속 가능합니다.

### 6. SDStudio PC 데이터 이전 (선택)

기존 SDStudio PC 버전의 프리셋/바이브를 가져오려면:

```bash
# PC에서 서버로 데이터 복사 (scp 또는 직접 복사)
# Windows 기준 SDStudio 데이터 위치:
#   %APPDATA%\SDStudio\SDStudio\

# 필요한 폴더만 복사:
#   projects/ → nai-studio/data/projects/    (프리셋, 씬)
#   vibes/    → nai-studio/data/vibes/       (바이브 이미지)
#   inpaints/ → nai-studio/data/inpaints/    (인페인팅)
#   config.json → nai-studio/data/config.json (설정)
```

### 7. 태그 자동완성 활성화 (선택)

SDStudio PC의 `db.csv` 파일을 `nai-studio/data/` 에 복사하면 태그 자동완성이 활성화됩니다.

---

## 설정

`data/config.json` 에서 모델 버전 등을 설정할 수 있습니다:

```json
{
  "modelVersion": "4-5-full"
}
```

사용 가능한 모델:
| 값 | 모델 |
|-----|------|
| `4-5-full` | NovelAI Diffusion V4.5 Full (기본값) |
| `4-5-curated` | NovelAI Diffusion V4.5 Curated |
| `4-full` | NovelAI Diffusion V4 Full |
| `4-curated` | NovelAI Diffusion V4 Curated |

---

## 라이센스

이 프로젝트는 [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/) 라이센스로 배포됩니다.

서버 코드(`server.js`, `lib/`)에 포함된 일부 로직은 원본 SDStudio(MIT 라이센스)에서 파생되었으며, 이에 대한 고지는 아래 크레딧에 포함되어 있습니다.

---

## 크레딧

- **원작**: [sunho/SDStudio](https://github.com/sunho/SDStudio) (MIT License)
- **포크**: [Dd154663/SDStudio](https://github.com/Dd154663/SDStudio) — 이 프로젝트의 직접적인 프론트엔드 베이스
  - V4/V4.5 모델 지원, 캐릭터 레퍼런스, 프리셋 개선 등 다수의 기능 추가
- **이미지 씬 기능**: [dendenai.xyz](https://dendenai.xyz) 의 프리셋 기능에서 파생
