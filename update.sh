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

if [ "$LOCAL" = "$REMOTE" ]; then
    echo "✓ 이미 최신 버전입니다."
    if [ -f version.json ]; then
        VERSION=$(python3 -c "import json; print(json.load(open('version.json'))['version'])" 2>/dev/null || echo "?")
        echo "  버전: v$VERSION"
    fi
    exit 0
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
