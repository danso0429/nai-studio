#!/bin/bash
# SDStudio Remote 업데이트 스크립트
# 사용법: cd ~/nai-studio && ./update.sh
set -e
cd "$(dirname "$0")"

# 배포별 설정 자동 감지 (.env.local + 디렉토리명)
if [ -f .env.local ]; then
    set -a; . ./.env.local; set +a
fi
PORT="${PORT:-6247}"
PM2_NAME="${NAI_PM2_NAME:-$(basename "$PWD")}"

echo "🔍 최신 버전 확인 중..."
git fetch origin main --quiet

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
LOCAL_SHORT=$(git rev-parse --short HEAD)

# 빌드 동기화 검사: deploy된 build-info.json의 gitHash가 HEAD와 일치하는지
BUILT_HASH=""
if [ -f public/build-info.json ]; then
    BUILT_HASH=$(python3 -c "import json; print(json.load(open('public/build-info.json')).get('gitHash',''))" 2>/dev/null || echo "")
fi

if [ "$LOCAL" = "$REMOTE" ] && [ "$BUILT_HASH" = "$LOCAL_SHORT" ]; then
    echo "✓ 이미 최신 버전이고 빌드도 동기화됨."
    if [ -f version.json ]; then
        VERSION=$(python3 -c "import json; print(json.load(open('version.json'))['version'])" 2>/dev/null || echo "?")
        echo "  버전: v$VERSION (gitHash=$LOCAL_SHORT)"
    fi
    exit 0
fi

if [ "$LOCAL" = "$REMOTE" ]; then
    echo "ℹ️  git은 최신이지만 빌드가 stale (built=${BUILT_HASH:-none}, HEAD=$LOCAL_SHORT) → 재빌드 진행"
fi

# 큐 활성 체크 (선택)
if command -v pm2 &> /dev/null && pm2 describe "$PM2_NAME" &> /dev/null; then
    QUEUE=$(curl -s "localhost:$PORT/api/queue/status" 2>/dev/null || echo '{}')
    PENDING=$(echo "$QUEUE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('pending',0))" 2>/dev/null || echo "0")
    if [ "$PENDING" != "0" ]; then
        echo "⚠️  대기 중인 이미지 생성 작업 $PENDING개"
        read -p "   업데이트하면 큐가 초기화됩니다. 계속? (y/N): " CONFIRM
        [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ] && { echo "취소됨."; exit 0; }
    fi
fi

echo ""
echo "📥 코드 업데이트..."
git pull origin main

echo "📦 의존성 갱신..."
npm install --silent

echo "🔨 프론트엔드 빌드..."
cd frontend
npm install --silent
npx vite build --emptyOutDir
cd ..

echo "📋 build-info.json 갱신..."
HASH=$(git rev-parse --short HEAD)
VER=$(python3 -c "import json; print(json.load(open('version.json'))['version'])" 2>/dev/null || echo "?")
SDSBASE=$(python3 -c "import json; print(json.load(open('version.json'))['sdstudioBase'])" 2>/dev/null || echo "?")
cat > public/build-info.json <<EOF
{"buildTime":"$(date -u '+%Y-%m-%dT%H:%M:%SZ')","gitHash":"$HASH","version":"$VER","sdstudioBase":"$SDSBASE"}
EOF
echo "  → version=$VER gitHash=$HASH"

echo "🔄 서버 재시작..."
if command -v pm2 &> /dev/null && pm2 describe "$PM2_NAME" &> /dev/null; then
    pm2 restart "$PM2_NAME"
    echo "✓ pm2로 재시작 완료 ($PM2_NAME)"
else
    echo "ℹ️  pm2 미사용 환경 — 서버를 수동으로 재시작해주세요."
    echo "   (예: node server.js)"
fi

if [ -f version.json ]; then
    NEW=$(python3 -c "import json; print(json.load(open('version.json'))['version'])" 2>/dev/null || echo "?")
    echo ""
    echo "✓ 업데이트 완료: v$NEW"
fi
