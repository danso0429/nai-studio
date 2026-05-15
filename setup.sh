#!/bin/bash
# SDStudio Remote 첫 설치 스크립트
# 사용법: git clone 후 디렉토리에서 ./setup.sh (또는 bash setup.sh)
#
# 하는 일:
#   1. Node.js 18+ 확인
#   2. .env.local 준비 (없으면 .env.example 복사, 있으면 보존)
#   3. backend 의존성 설치
#   4. frontend 의존성 설치 + vite 빌드
#   5. public/build-info.json 생성
#
# 안 하는 일 (사용자가 해야 함):
#   - NAI TOKEN 저장 (data/TOKEN.txt)
#   - 서버 켜기 (node server.js 또는 pm2)
#
# 재실행 안전 — 기존 .env.local/node_modules/build 손상 X.
set -e
cd "$(dirname "$0")"

echo "🔍 Node.js 확인..."
if ! command -v node &> /dev/null; then
    echo "✗ Node.js가 설치되어 있지 않아요."
    echo "  설치: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs build-essential git"
    exit 1
fi
NODE_VER=$(node --version)
NODE_MAJOR=$(echo "$NODE_VER" | sed -E 's/^v([0-9]+).*/\1/')
if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "✗ Node.js 18+ 필요 (현재 $NODE_VER)"
    exit 1
fi
echo "  → $NODE_VER ✓"

echo ""
echo "⚙️  설정 파일 준비..."
if [ -f .env.local ]; then
    echo "  → .env.local 이미 있음 — 보존 (덮어쓰기 X)"
else
    if [ -f .env.example ]; then
        cp .env.example .env.local
        echo "  → .env.local 생성 (.env.example에서 복사)"
        echo "  ※ 기본값으로 진행하면 추후 https://your-host/studio 경로 노출."
        echo "    다른 경로/포트 원하면 'nano .env.local' 편집 후 이 스크립트 다시 실행."
    else
        echo "  ⚠ .env.example 없음 — 건너뜀"
    fi
fi

echo ""
echo "📦 backend 의존성 설치... (1~2분)"
npm install --silent

echo ""
echo "🔨 frontend 의존성 + 빌드... (2~3분)"
(
    cd frontend
    npm install --silent
    npx vite build --emptyOutDir
)

echo ""
echo "📋 build-info.json 생성..."
HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
VERSION="?"
SDSBASE="?"
if [ -f version.json ]; then
    out=$(python3 -c "
import json
try:
    d = json.load(open('version.json'))
    print(d.get('version','?'), d.get('sdstudioBase','?'))
except Exception:
    print('?', '?')
" 2>/dev/null || echo "? ?")
    VERSION="${out%% *}"
    SDSBASE="${out#* }"
fi
mkdir -p public
cat > public/build-info.json <<EOF
{"buildTime":"$(date -u '+%Y-%m-%dT%H:%M:%SZ')","gitHash":"$HASH","version":"$VERSION","sdstudioBase":"$SDSBASE"}
EOF
echo "  → version=$VERSION gitHash=$HASH"

# .env.local 적용 (PORT 안내용)
PORT="6247"
URL_PREFIX="/studio"
if [ -f .env.local ]; then
    set -a; . ./.env.local; set +a
    PORT="${PORT:-6247}"
    URL_PREFIX="${URL_PREFIX:-/studio}"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✓ 설치 완료!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "다음 단계:"
echo ""
echo "1. NAI 토큰 저장 (선택 — 웹 UI에서 이메일/비번으로도 로그인 가능):"
echo "     mkdir -p data"
echo "     nano data/TOKEN.txt   # NAI Persistent API Token 붙여넣기"
echo "     chmod 600 data/TOKEN.txt"
echo ""
echo "2. 서버 켜기 (둘 중 하나):"
echo "   • 테스트 (Ctrl+C로 종료):"
echo "       node server.js"
echo "   • 상시 운영 (pm2 권장):"
echo "       sudo npm install -g pm2"
echo "       pm2 start server.js --name nai-studio"
echo "       pm2 save && pm2 startup"
echo ""
echo "3. 접속:"
echo "     같은 네트워크: http://<서버IP>:${PORT}${URL_PREFIX}/"
echo "     Tailscale 권장 (외부 접속): README의 Step 6 참조"
echo ""
echo "업데이트는 'cd $(pwd) && ./update.sh' 한 줄로."
echo ""
