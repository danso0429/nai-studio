#!/usr/bin/env bash
# regen-build-info.sh — public/build-info.json을 현재 git HEAD + version.json 기준으로 재생성.
#
# 동기: update.sh는 self-update 흐름(git pull → npm install → vite build → restart)에서
# build-info.json을 갱신해주지만, 직접 commit + push 흐름에선 누락. /api/build-info가
# 이 파일을 1순위로 읽어 사용자 UI에 표시 → stale이면 update 펄스/버전 표시가 옛 hash로
# 박혀 사용자가 새 빌드 인지 못함.
#
# P19 #6 사고(v1.7.1→1.7.2 펄스 stuck)와 P20 #3-후속(2026-05-22 ctrl+click/heartbeat
# commit 후 stale) 두 번 발생한 직접 동인. 이 helper로 dev/release 양쪽 재사용.

set -e

cd "$(dirname "$0")/.."

HASH=$(git rev-parse --short HEAD)
BUILD_TIME=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
VERSION=$(python3 -c "import json; print(json.load(open('version.json'))['version'])")
SDSBASE=$(python3 -c "import json; print(json.load(open('version.json'))['sdstudioBase'])")

cat > public/build-info.json <<EOF
{"buildTime":"$BUILD_TIME","gitHash":"$HASH","version":"$VERSION","sdstudioBase":"$SDSBASE"}
EOF

echo "build-info.json 갱신: version=$VERSION gitHash=$HASH sdstudioBase=$SDSBASE buildTime=$BUILD_TIME"
