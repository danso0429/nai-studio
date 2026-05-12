#!/bin/bash
# cleanup_old_files.sh — 7일 이상 된 tmp/exports 파일 자동 삭제
# cron: 0 5 * * * ~/nai-studio-2/cleanup_old_files.sh

DATA_DIR="$HOME/nai-studio-2/data"

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
