#!/bin/bash
# SDStudio (Dd154663 fork) 업데이트 감지 스크립트
# 일주일에 한 번 cron으로 실행

REPO="Dd154663/SDStudio"
STATE_FILE="$HOME/.sdstudio_last_commit"
LOG_FILE="$HOME/sdstudio_update.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# GitHub API로 최신 커밋 SHA 가져오기
LATEST=$(curl -s "https://api.github.com/repos/${REPO}/commits/main" | grep '"sha"' | head -1 | cut -d'"' -f4)

if [ -z "$LATEST" ]; then
    log "ERROR: GitHub API 호출 실패"
    exit 1
fi

# 이전 커밋과 비교
if [ -f "$STATE_FILE" ]; then
    PREV=$(cat "$STATE_FILE")
    if [ "$LATEST" = "$PREV" ]; then
        log "변경 없음 (${LATEST:0:7})"
        exit 0
    fi
    # 변경 감지!
    log "=== 업데이트 감지! ==="
    log "이전: ${PREV:0:7}"
    log "최신: ${LATEST:0:7}"
    log "확인: https://github.com/${REPO}/compare/${PREV:0:7}...${LATEST:0:7}"

    # 서버에 알림 파일 생성
    echo "SDStudio 업데이트 감지 ($(date '+%Y-%m-%d %H:%M'))" > "$HOME/SDSTUDIO_UPDATE_DETECTED"
    echo "이전: ${PREV:0:7}" >> "$HOME/SDSTUDIO_UPDATE_DETECTED"
    echo "최신: ${LATEST:0:7}" >> "$HOME/SDSTUDIO_UPDATE_DETECTED"
    echo "비교: https://github.com/${REPO}/compare/${PREV:0:7}...${LATEST:0:7}" >> "$HOME/SDSTUDIO_UPDATE_DETECTED"
else
    log "초기 실행, 현재 커밋 저장: ${LATEST:0:7}"
fi

echo "$LATEST" > "$STATE_FILE"
