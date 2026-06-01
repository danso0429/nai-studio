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

# version.json 파싱 — VERSION/SDSBASE 갱신. git pull 후 재호출 가능.
read_version_json() {
    VERSION="?"
    SDSBASE="?"
    [ -f version.json ] || return 0
    local out
    if out=$(python3 -c "
import json
try:
    d = json.load(open('version.json'))
    print(d.get('version','?'), d.get('sdstudioBase','?'))
except Exception:
    print('?', '?')
" 2>/dev/null); then
        VERSION="${out%% *}"
        SDSBASE="${out#* }"
    fi
}
read_version_json

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

# Dirty working tree 검사 — skip 판정 + 가드 양쪽에서 사용.
# commit 안 된 source가 있으면 build-info gitHash가 HEAD와 같아도 빌드가 stale일 수
# 있어 skip하면 안 됨 (uncommitted 변경은 HEAD에 안 잡히므로 gitHash만으론 못 봄).
# public/build/는 vite가 곧 재생성하니 제외.
DIRTY=$(git status --porcelain --untracked-files=normal \
    | grep -Ev '^.. public/build/' || true)

if [ "$LOCAL" = "$REMOTE" ] && [ "$BUILT_HASH" = "$LOCAL_SHORT" ] && [ -z "$DIRTY" ]; then
    echo "✓ 이미 최신 버전이고 빌드도 동기화됨."
    echo "  버전: v$VERSION (gitHash=$LOCAL_SHORT)"
    exit 0
fi

if [ "$LOCAL" = "$REMOTE" ] && [ -z "$DIRTY" ]; then
    echo "ℹ️  git은 최신이지만 빌드가 stale (built=${BUILT_HASH:-none}, HEAD=$LOCAL_SHORT) → 재빌드 진행"
fi

# Dirty working tree 가드: vite build가 commit 안 된 source까지 빌드해 배포되는
# 사고 방지. 그 외 modified/untracked는 차단. 우회: ALLOW_DIRTY=1 ./update.sh
if [ -n "$DIRTY" ] && [ "${ALLOW_DIRTY:-0}" != "1" ]; then
    echo ""
    echo "⚠️  working tree에 commit 안 된 변경이 있어요. vite build가 그 source까지"
    echo "    빌드해서 의도치 않은 변경이 배포될 수 있어요."
    echo ""
    echo "$DIRTY"
    echo ""
    echo "해결: (1) commit 또는 git stash, 또는 (2) ALLOW_DIRTY=1 ./update.sh"
    exit 1
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
# git pull 이후 version.json이 갱신됐을 수 있어 재파싱
read_version_json
cat > public/build-info.json <<EOF
{"buildTime":"$(date -u '+%Y-%m-%dT%H:%M:%SZ')","gitHash":"$HASH","version":"$VERSION","sdstudioBase":"$SDSBASE"}
EOF
echo "  → version=$VERSION gitHash=$HASH"

echo "🔄 서버 재시작..."
if command -v pm2 &> /dev/null && pm2 describe "$PM2_NAME" &> /dev/null; then
    # --update-env: .env.local export 값을 daemon에 재주입 (ecosystem PORT/URL_PREFIX 갱신)
    pm2 restart "$PM2_NAME" --update-env
    echo "✓ pm2로 재시작 완료 ($PM2_NAME)"
else
    echo "ℹ️  pm2 미사용 환경 — 서버를 수동으로 재시작해주세요."
    echo "   (예: node server.js)"
fi

echo ""
echo "✓ 업데이트 완료: v$VERSION"
