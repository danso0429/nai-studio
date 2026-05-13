#!/bin/bash
# cleanup_old_files.sh — 자동 정리 cron 스크립트
# cron: 0 5 * * * ~/nai-studio-2/cleanup_old_files.sh
#
# 1. tmp/exports: 7일 이상 된 파일 삭제
# 2. fastcache: 30일 이상 안 쓴 썸네일 삭제 (재생성 가능, 무한 누적 회피)

DATA_DIR="$HOME/nai-studio-2/data"

# tmp/exports 7일 이상 정리
for DIR in "$DATA_DIR/tmp" "$DATA_DIR/exports"; do
  if [ -d "$DIR" ]; then
    COUNT=$(find "$DIR" -type f -mtime +7 | wc -l)
    if [ "$COUNT" -gt 0 ]; then
      find "$DIR" -type f -mtime +7 -delete
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] Cleaned $COUNT files from $DIR"
    fi
    # 빈 하위 디렉토리도 정리
    find "$DIR" -mindepth 1 -type d -empty -delete 2>/dev/null
  fi
done

# fastcache 30일 이상 안 쓴 썸네일 정리 (atime 기반).
# 썸네일은 ImageService가 필요 시 재생성하므로 손실 X.
# disk-low 시 server.js의 diskCleanupStage2 가 즉시 전부 정리하지만,
# 평상시 점진적 회수는 여기서 처리.
FASTCACHE_COUNT=$(find "$DATA_DIR" -path "*/fastcache/*" -type f -atime +30 2>/dev/null | wc -l)
if [ "$FASTCACHE_COUNT" -gt 0 ]; then
  find "$DATA_DIR" -path "*/fastcache/*" -type f -atime +30 -delete 2>/dev/null
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Cleaned $FASTCACHE_COUNT stale fastcache files"
fi
