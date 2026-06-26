# 변경 이력

이 파일은 SDStudio Remote의 모든 변경사항을 기록합니다.

버전 형식: `MAJOR.MINOR.PATCH` (Semantic Versioning)
- **MAJOR**: 기존 데이터 호환성이 깨지는 변경
- **MINOR**: Phase 진입 또는 큰 기능 추가
- **PATCH**: 버그 수정, 작은 개선

minor(`v1.X`)별로 묶고, 그 아래 patch(`v1.X.Y`)를 둡니다. sdstudioBase는 흡수한 SDStudio PC 버전.

---

## v1.11

### v1.11.0 — minor (2026-06-26) — SDStudio 본가 4.10 → 4.12 통합

본가 SDStudio 4.10~4.12.2의 주요 기능을 통합. (작가 라이브러리 등 일부 4.12 항목은 다음 릴리즈로 보류. sdstudioBase 4.10.0 → 4.12.2.)

**그림체 글로벌 프리셋 라이브러리 (통합)**
1. 이지/일반으로 갈렸던 그림체 글로벌 프리셋을 **하나의 라이브러리로 통합** — 두 섹션 → 단일 카드 그리드.
2. **검색 + 정렬**(최근 수정/이름/기본 우선), 카드별 **편집 모달**(이름·상위/하위/네거티브 프롬프트·스텝·가이던스·CFG·샘플링·노이즈·대표 이미지), **멀티선택 일괄 작업**(세션으로 일괄 가져오기·기본 지정·삭제).
3. 프리셋 적용 시 **현재 활성 모드(이지/일반)로 자동 변환**(같은 모드면 무변경).
4. PNG 가져오기 — 정식 글로벌 프리셋 이미지뿐 아니라 **NAI 메타데이터가 있는 일반 PNG**도 프롬프트를 추출해 그림체로 흡수.

**프로젝트별 저장 공간 관리**
5. 환경설정 → '이미지 및 데이터 저장경로'에 **프로젝트별 차지 용량(이미지 포함) 확인** 추가. 용량 큰 프로젝트(3GB↑ 강조)를 찾아 정리. 부하 방지를 위해 수동 계산 + 결과 저장(서버에서 1콜 계산).

**전체 데이터 백업 / 복원**
6. **백업 누락 버그 수정** — 전체 백업이 글로벌/그림체/청크/샘플링/토글/내보내기 프리셋과 폴더 설정을 빠뜨려, 전체 백업으로 복원하면 그것들이 증발하던 것. 이제 전부 포함(생성 이미지 `outs`/이전 내보내기 `exports`는 의도적 제외 유지).
7. **백업 복원 신설** — 받은 백업 zip을 다시 불러와 복원. 이름이 같은 프로젝트는 **새 이름으로(권장)/건너뛰기/덮어쓰기(2중 확인)**, 프리셋 등 설정은 **병합**(현재 항목 유지 + 백업의 새 항목만 추가). 업로드→서버 추출 방식(대용량·모바일 안전), 복원 전 현재 설정 자동 스냅샷, 압축 해제 경로 검증(Zip Slip 방지).

**내보내기 프리셋 파일 이관**
8. 브라우저 localStorage에만 있던 내보내기 프리셋을 **서버 파일로 이관** — 모바일에서 브라우저 데이터를 지우면 증발하던 것 + 전체 백업 누락 해소.

---

## v1.10

### v1.10.0 — minor (2026-06-10) — 코드베이스 전체 점검

새 기능보다 안정성·견고성 위주. 코드베이스 전체를 점검해 찾은 20건을 전부 동작 보존(정상 동작 그대로, 깨지는 경우만 수정)으로 처리.

**데이터 안정성 (손실 방지)**
1. 큐 처리 중 작업을 취소하면 *다음* 작업이 큐에서 사라지던 것 — 방금 처리한 작업만 정확히 제거하도록.
2. 프로젝트 이름 변경 후 그 프로젝트를 편집하면 새로고침 시 사라지던 것 — 이름 변경 후에도 편집이 정상 저장.
3. 다이얼로그(이름 변경·씬 통합·트래시 비우기·이미지 이동 등)가 떠 있을 때 프로젝트를 바꾸면 *엉뚱한* 프로젝트에 적용되던 것 — 다이얼로그 연 시점의 프로젝트에 일관 적용.
4. 큐 상태 파일이 손상되면 무음으로 큐를 잃던 것 — 손상본을 보존하고 큐 페이지(`/queue`) 상단에 경고 배너로 알림.
5. 글로벌 캐릭터 프리셋 파일 손상 시 백업 없이 덮어쓰던 것 — 손상본 백업 후 초기화. 캐릭터 프리셋도 탭 닫을 때 저장(편집 직후 손실 방지).

**견고성 / 보안**
6. NAI가 응답 없이 멈출 때(이미지 수정·바이브 인코딩) 영구 대기하던 것 — 타임아웃으로 끊고 에러 반환.
7. 압축 해제(프로젝트/백업 복원) 시 경로 검증 추가 (Zip Slip 방지).
8. 디스크 자동 정리가 동기 실행이라 정리 중 서버가 잠깐 멈추던 것 — 비동기로 전환.
9. 전체 백업 zip에서 NAI 토큰 제외 (백업 유출 시 토큰 노출 방지, 복원 후 재로그인).
10. (fix) rclone 미설치 환경에서 프로젝트 단일 내보내기가 깨지던 것 정상화.

**동작 개선**
11. 전체 큐 취소(달력 X)·'중지' 버튼에 확인 다이얼로그 — 실수 1번에 대기 큐 전체를 잃지 않도록.
12. Drive **'전체 재시도'**가 이제 실패(최종 포기)한 항목도 되살려 재시도 + 실패 원인 전체 로그 (옛날엔 실패 항목은 전체 재시도해도 안 됐음).
13. 자체 다이얼로그가 열린 채 화면에 파일을 떨궈도 임포트가 끼어들지 않게 (데스크탑 드래그드롭).

**내부 정리** (사용자 영향 없음)
14. 프리셋 5종(토글그룹·프롬프트청크·샘플링·글로벌·글로벌 캐릭터)의 저장 로직을 공통 base로 통합.
15. rclone 결과 처리·큐 페이지 추출 로직 중복 통합, 미사용 코드(파일/함수/CLI) 제거.

**큐 등록 / 드로어** (`v1.9.5-experimental.1` 흡수 — pre-release 체크포인트로 먼저 나왔던 것)
16. 씬 일괄 등록(예약)을 백그라운드 전송으로 — 인터넷이 느리거나 등록 직후 앱을 백그라운드로 보내도 끝까지 대기로 올라가도록, 클라가 프롬프트만 만들어 한 번에 전송하고 서버가 바이브/레퍼런스 인코딩 + 예약 + 대기 전환을 백그라운드로 처리(씬마다 수백 번 오가던 것을 1회로). 설정 "기타" 탭의 **"씬 일괄 등록 백그라운드 전송"**으로 켜는 실험 기능(기본 꺼짐 = 기존 동작 그대로, 일반 모드 전용 · 이지모드 제외).
17. 4.10 폴더 드로어에 앱 전체 백업/복원(불러오기·내보내기·전체백업) 진입 복원 — 내보내기는 별도 창이 아니라 드로어 인플레이스 "선택 모드", 폴더/즐겨찾기/미분류 헤더에 그룹 전체선택 체크박스(이동·내보내기 공통).

---

## v1.9

### v1.9.4 (2026-06-07) — SDStudio v4.10.0 흡수

**SDStudio 4.10 통합**
1. 프로젝트 선택을 좌측 슬라이드 **폴더 드로어**로 — 폴더 색상·즐겨찾기·드래그 이동/정렬·인라인 이름편집·프로젝트 복제·⋮메뉴(큐등록/내보내기/백업/이동/삭제). 설정에서 "새 폴더 드로어 UI"를 끄면 옛 모달로 복귀.
2. 폴더 색상/순서를 서버에 저장(다기기 동기화).
3. 프로젝트 복제(이미지 포함/미포함).
4. 글로벌(프로젝트 공통) 캐릭터 프리셋 — 캐릭터 프리셋 화면 "글로벌" 버튼으로 저장/불러오기.
5. 모바일 폴더 색상 HSL 피커.
6. 예약(큐) 시점 레퍼런스/바이브 스냅샷 — 예약 후 프리셋을 수정해도 이미 예약된 작업은 불변.
7. 선택 다이얼로그 항목이 많을 때 스크롤.

**대량 작업 백그라운드화**
8. 씬 이미지 일괄 삭제를 서버 백그라운드로 — 다른 프로젝트로 가도·앱이 백그라운드여도 끝까지 진행, 삭제 중 생성이 멈추지 않음.
9. 폴더 삭제 백그라운드화 + 진행률.

**큐 안정성**
10. 예약→대기 orphan 자동복구 시스템(heartbeat 기반, vibe 재인코딩 0 = Anlas 0 보장).
11. 인페인트 빈 마스크 가드(NAI 500 방지).
12. auto-cleanup 휴지통 메타 파일명 정합(3일 자동정리 복구).
13. 데스크탑 이미지 선택모드 Ctrl 토글, queue 직전소요 카드 2칸화.

### v1.9.3 (2026-06-01)
1. 데스크탑 Ctrl 누르는 동안 이미지 선택모드 (떼면 해제).
2. 씬 결과 상단 제목 클릭 시 씬 이름 바로 편집.
3. "다른 씬으로 이미지 복사" → "이동" (생성정보·즐겨찾기 유지).
4. 씬 복사 대상 프로젝트 선택을 폴더 그룹 dropdown으로.
5. 조합 에디터 첫 행 삭제 제한 완화 (조각 1개일 때만 차단).
6. chunk 관리 태그(content) 칸 db.csv 자동완성.
7. chunk 알약 뒤/앞 paste 시 ", " 자동 구분자.
8. (fix) update.sh: dirty면 빌드 skip 안 하도록 판정 보강.

### v1.9.2 (2026-06-01)
1. 캐릭터 프롬프트/네거티브 칸에 +chunk 버튼 (알약 삽입 → 생성 시 펼침).
2. 조합·씬 전용 네거티브 칸에 db.csv 태그 자동완성.

### v1.9.1 (2026-05-31)
1. 프롬프트 찾기 — 씬 이름 + 상위/하위/네거티브 칸 태그 형광 강조 (chunk 알약 포함).
2. 매칭 X/Y + 다음/이전(Enter/Shift+Enter) 스크롤.
3. Ctrl+Shift+F 키바인딩 (씬 목록은 이름만 검색).

### v1.9.0 — minor (2026-05-31)
1. 프롬프트 chunk 시스템 (이름 붙인 태그 묶음 알약, 커서 삽입/생성 시 펼침, 원자화·경계 자동 쉼표·죽은 토큰 정리·호버 미리보기).
2. 샘플링 프리셋 별도 저장·적용/해제.
3. 그림체(프롬프트) 프리셋 폐기 — chunk + 샘플링이 대체 (기존 내용 텍스트 백업).
4. 조합 에디터 drag UX (슬롯 자유 드래그, 빈 공간 새 열, 빈 열 삭제).
5. 씬 토글 그룹 (충돌 태그 묶어 on/off, 정의 전역 공유·on/off 프로젝트별).
6. 다른 프로젝트로 프롬프트 복사 (폴더 트리 + chunk 포함/제외).
7. (fix) 알약 클릭 caret 보정, paste/caret Firefox fix, 좌우 반전 버튼.

---

## v1.8

### v1.8.2 (2026-05-27) — SDStudio v4.9.0 흡수
1. 캐릭터 프리셋 다중 캐릭터 (fromPreset 태그, 기존 바이브/레퍼런스 유지).
2. 프로젝트 브라우저 카드 그리드 (썸네일·검색·최근·즐겨찾기).
3. 다른 프로젝트로 씬 복사 (개별 + 일괄, 이미지 포함/설정만).
4. 트루 다크 모드 (다크/트루다크/화이트 3택, queue.html 자동 적용).
5. 캐릭터 위치 좌표평면 드래그 UI.
6. queue.html 직전 소요 vs 시간대 평균 비교 카드.
7. (perf) 앱 시작 블로킹 제거·병렬화. (fix) 바이브 손상 skip, 순차 생성 쿨다운.

### v1.8.1 (2026-05-27)
1. orphan reserved 재예약 (서버 재시작 후 fill 못 한 예약 자동 감지 + 재예약).
2. 씬 순서 변경 UI (reorder 모드 + 좌우 이동).
3. 프로젝트 단위 예약 취소.
4. (fix) 프리셋 session 기반 resolve, stats 이중 차감 방지, 이름 충돌 suffix.

### v1.8.0 — minor (2026-05-25)
1. 그림체 프리셋 자유 합성 (slot lock 폐기, 사용자 텍스트 앞에 prepend, 적용/해제 override 모델).
2. 큐 예약 시스템 (reserve/fill — prep 중 새로고침해도 예약 유지, queue.html 예약 카드).
3. 폴더 백업 다중 복원 UI + 임포트 시 저장 폴더 강제 선택.
4. 폴더/프로젝트 한 번에 큐 등록 (dedup + 진행 toast).
5. 데스크탑 ctrl+click 이미지 선택모드.
6. WS heartbeat ping/pong 30s (iOS Safari idle stale 감지).
7. 진행 카운터 KST 자정 리셋, 큐 한도 7000.
8. (perf) 큐 영속화 base64 dedupe (107MB→0.9MB, stringify 47x), ETA cross-hour 시뮬, scene-job-complete debounce.
9. (fix) 20+ 버그 — WS 재연결/visibility refreshBatch, 카운터 정확도, 클립보드 user activation, 인페인트 fit 등.

---

## v1.7

### v1.7.3 (2026-05-21)
1. 다중 프로젝트 내보내기 (트리 picker N개 선택, 백그라운드 + 4병렬, 진행 중 delete/rename 락).
2. Drive 위젯 개별 [재시도] 즉시 처리 + per-row 시각화.
3. SDStudio v4.8.1/v4.8.2 흡수 (캐릭터 프리셋 cleanup, prefix_ask 캐릭터 이름 입력).
4. 업스트림 SDStudio 새 release 알림 (indigo 🔧 펄스).

### v1.7.2 (2026-05-21)
1. fresh install 안내 정확화 (`~/nai-studio` 경로 통일, rclone wizard 단계 안내).
2. (fix) GitHub 링크 3곳 본 fork로 정정.
3. (security) self-update 에러 응답 abs path 마스킹, TLS cert/키 gitignore 가드, defaultassets metadata 스트립.

### v1.7.1 (2026-05-21)
1. (fix) WS path strip — noServer 모드로 URL_PREFIX strip을 WS upgrade에도 적용 (path strip 안 하는 reverse proxy 환경 cover).
2. 큐 카운터 commit-based 재설계 + add↔restore race fix.
3. queue.html '대기' 카드 → 폴더/프로젝트/씬 3단 트리 + 단위별 취소.
4. 폴더 안 프로젝트 rename/import 폴더 유지, 폴더 영구 삭제 batch API.
5. 단일 다운로드 unique filename (Drive 덮어쓰기 차단).
6. (perf) audit 11카테고리 ~100건 — 서버 walkDir cap·debounce·yield, 이미지 mutex 재설계·LRU cap, 클립보드/JSON 청크 병렬 등.
7. (docs) audit 11카테고리 instructions + agent S1-S5 protocol.

### v1.7.0 — minor (2026-05-17)
1. 자동 업데이트 시스템 — UI 한 클릭(SSH 불필요), NDJSON 단계별 진행 + pm2 restart, NAI 로그인 상태로 인증.
2. (docs) README 업데이트 방법 갱신 (UI 자동 / 수동 SSH).

---

## v1.6

### v1.6.1 (2026-05-17)
1. (fix) restoreMirroredState single-flight 가드 — 카운트 부풀음 해소.
2. 큐 list UI 리뉴얼 — 폴더/프로젝트/씬 3단 트리, 우선순위 큐(⭐ toggle), 카운터 snapshot 모델, portal popup.
3. 다중 프로젝트 임포트 (드래그드롭 ≥2 JSON 3-way select, iOS 파일 picker multiple).
4. (ui) 프로젝트 선택 헤더/버튼 rename.

### v1.6.0 — minor (2026-05-17) — SDStudio v4.8.0 부분 흡수
1. (fix) references/ export·import 4곳 누락 데이터 손실 회귀.
2. 캐릭터 프리셋 UI 대개편 (모달 + 카드 그리드 + 대표 이미지 + 상세 슬라이더).
3. 캐릭터 프리셋 JSON Import/Export.
4. 순차 생성 (프리셋 N × 씬 M 자동 순회, 일시정지/재개/취소).
5. (fix) catalog 정독 후속 149건 — 명백 버그 8 + refactor C 12 + dead code A 91 + 재작성 B 38.
6. (fix) 즐겨찾기 export 폴백 제거 (별표 0개면 안내+중단).

---

## v1.5

### v1.5.3 (2026-05-15) — 180 commit
1. 폴더 시스템 + 폴더 전체 백업/복원 (1 tar 묶음, Drive backups/ 자동 분류).
2. 단일 이미지 다운로드 → Drive 직행 (다이얼로그 폐기, 단일 버튼).
3. 씬 안 큐 자동 갱신 disk polling 안전망.
4. 순차 다이얼로그 일체화 3건 (해상도/씬이름/이미지 변형).
5. (security) 감사 권고 7건 — README 위협모델, TOKEN.txt 차단, CSP enforce, rclone execFile, 로그인 rate limit.
6. (fix) BatchItemSelector iOS click delay 우회 (408ms→50ms).
7. (perf) 인터넷 느린 환경 fit — compression(3.5x), WebP 썸네일(10.5x), 초기 크기 자동.

### v1.5.3-experimental.4 (2026-05-15)
1. (security) 감사 권고 7건 일괄 적용.

### v1.5.3-experimental.3 (2026-05-15)
1. (chore) iOS click delay 진단 marker 측정 인프라 제거.

### v1.5.3-experimental.2 (2026-05-14)
1. viewport-fit=cover 재시도 (safe-area-inset 4축).
2. extractApiError 401/429/timeout 한국어 메시지.
3. ModalOverlay focus trap + 빈 씬 empty state.
4. (perf) queue.html 모바일 paint/배터리 7축.

### v1.5.3-experimental.1 (2026-05-14)
1. BatchItemSelector 전체 swap (구 SceneSelector 제거, 0.5초 fix 흡수).
2. ResourceSyncService retry 옵션 (일시 에러 재시도, 4xx 즉시 throw).
3. 폴더 전체 내보내기.

### v1.5.3-preview.3 (2026-05-13)
1. (fix) 5/14 회귀 묶음 (캐시 헤더/예약 취소/씬 선택 렉).
2. queue.html 전체정리 미리보기 + iOS confirm() → HTML 모달.
3. (safety) driveRetry save debounce, atomic write helper.
4. (ux) 보안 헤더, destructive 액션 명시 텍스트.

### v1.5.3-preview.2 (2026-05-13)
1. queue.html maintenance UI (tmp/exports wipe + orphan cleanup).
2. 서버 큐 평균 기반 ETA.
3. update.sh dirty working tree 가드.
4. (perf) 청크 4 병렬 패턴 일괄 (이미지 변형/mergeScenes/addAllToQueue/autoCleanup).

### v1.5.3-preview.1 (2026-05-13)
1. 부팅 시 imageMap reconcile (25 프로젝트 / 4754 stale 정리, 부팅 블록 0ms).
2. 씬 일괄 임포트 스키마에 scene.uc + piece.uc.

### v1.5.2 (2026-05-13)
1. 씬/조합 단위 네거티브 (scene.uc + PromptPiece.uc).
2. 프로젝트 영구 삭제 + 이미지 내보내기 동시 10개.
3. queue.html 처리 중 프로젝트 큐 잔여 수 표시.
4. (perf) 영구 삭제/일괄 삭제 백그라운드 + 청크 4 병렬.

### v1.5.1-preview.4 (2026-05-12)
1. 씬 일괄 임포트 (schema + dryRun + overwrite/skip).
2. 프로젝트 영구 삭제 (로컬 + Drive) + WS 진행 토스트.

### v1.5.1-preview.3 (2026-05-12)
1. 프로젝트 임포트 진행 알림 + deep import 5x 가속.

### v1.5.1-preview.2 (2026-05-12)
1. 프로젝트 폴더 시스템 + 백업 메뉴 분리.
2. queue 통계 영구 누적 (2시간 12-bucket KST).

### v1.5.1-preview.1 (2026-05-12)
1. 대량 작업 '씬들 통합' + 이미지 합치기 + 슬롯 dedup.
2. queue.html 완료 탭 (프로젝트별 batch + retention).
3. (fix) refreshBatch retry로 모바일 cold start 회복, NAI 5xx retry.

### v1.5.0 (2026-05-12)
1. 클라 큐 → 서버 큐 통합 (mirror 인프라 — gen/inpaint/i2i 서버 큐 경유).
2. mirror state 자동 재동기화 (30s polling + WS reconnect).
3. 이미지 내보내기 프리셋 + 자동완성 split 레이아웃.
4. (refactor) rclone remote 이름 환경변수화.
5. (docs) README 종합 재작성 (뉴비 친화).

### v1.5.0-preview.6 (2026-05-12)
1. 이미지 내보내기 서버 측 pipeline (HTTP 202 + WS).
2. Drive retry 큐 동시성 N=3 병렬.

### v1.5.0-preview.5 (2026-05-12)
1. queue.html Drive 업로드 위젯 + 백그라운드 sync.
2. 씬 이름 내보내기.
3. (refactor) extractApiError/syncExportToDrive/apiUrl 헬퍼 추출, version-check/tag-search 모듈 분리.

### v1.5.0-preview.4 (2026-05-12)
1. (chore) TS 26→3 (88% 정리, Electron 잔재 제거).
2. P15 Step A 썸네일 시도 후 회귀로 revert.

### v1.5.0-preview.3 (2026-05-11)
1. (infra) vite outDir을 public/build/로 분리 (emptyOutDir이 queue.html 휩쓸던 회귀 차단).
2. /api/fs/zip 전부 누락 시 500→400 + 깔끔 표시.
3. (perf) 휴지통 썸네일 병렬화(-45%), fetchImage 1 round-trip.

### v1.5.0-preview.2 (2026-05-11)
1. Drive 재시도 exponential backoff (6회) + 즉시/dismiss/reset endpoint.
2. Drive 재시도 알약 위젯 + 모달.
3. /api/fs/zip ENOENT 자동 skip.

---

## v1.4

### v1.4.5 (2026-05-11)
1. 대량 이미지 삭제 병렬화 (move-batch Promise.all, ~4배).

### v1.4.4 (2026-05-11)
1. 모바일 알약 overflow 처리.
2. update.sh가 build-info.json 갱신 (build-info gitignore로 이동).

### v1.4.3 (2026-05-11)
1. update.sh PORT/pm2 이름 자동 감지 (하드코딩 제거).

### v1.4.2 (2026-05-11)
1. base path/port/prefix 환경변수화 (.env.local).

### v1.4.1 (2026-05-10)
1. 다중 선택 이미지 일괄 즐겨찾기 토글.

### v1.4.0 (2026-05-10)
1. 라이센스 → PolyForm Noncommercial 1.0.0 + README 보안 경고 + resolvePath hardening.

---

## v1.3

### v1.3.2 (2026-05-10)
1. (security) TOKEN.txt chmod 600 강제.

### v1.3.1 (2026-05-10)
1. (hotfix) vibe-locked listener lazy 등록 (앱 부팅 크래시).

### v1.3.0 (2026-05-10)
1. 임포트 속도 병렬 + Drive sync(단일 파일) + vibe lock 안내.

---

## v1.2

### v1.2.0 (2026-05-10)
1. README 풀 리뉴얼 + CHANGELOG.md + 자동 갱신 로직.

---

## v1.1

### v1.1.4 (2026-05-10)
1. 시연 후 버전 정상화 (내부 변경 없음).

### v1.1.3 (2026-05-10)
1. BuildInfo API 경로 수정, TobBar 뱃지 통합.

### v1.1.2 (2026-05-10)
1. 클라 버전 체크 + 업데이트 알림 (PC 뱃지 / 모바일 버전 표시).

### v1.1.1 (2026-05-10)
1. 버전 관리 인프라 (version.json, update.sh, /api/version-check).

### v1.1.0 — Phase 6 (2026-05-10)
1. Drive 자동 동기화 (내보내기 완료 시 즉시 업로드).
2. 알약에 처리 중 scene 이름 표시.

---

## v1.0

### v1.0.0 — Phase 5 (2026-05-09)
1. NAI v4.5 핵심 완전 검증 (바이브 트랜스퍼, 캐릭터 레퍼런스, 멀티 캐릭터, 모델 자동 잠금) — 첫 정식 출시.
2. (perf) saveQueueState 디바운스, rclone lsjson 일괄화(400초→3초), prewarm 3사이즈.
3. 모바일 두 줄 레이아웃.

### v1.0.0 이전 (개발 단계, 2026-04~05)
- **Phase 4**: AVIF 최적화, NAI 429 재시도, 서버 큐 실시간 UI(WS), 큐 영속화, 자동 배포.
- **Phase 3**: 이미지 미리보기(fastcache), NAI v4/v4.5 클라, fire-and-forget 큐, 태그 자동완성.
- **Phase 2**: SDStudio React UI 29 컴포넌트 이식, ServerBackend 46 메서드, Express+WS 서버.
- **Phase 1**: Oracle Cloud ARM 셋업, Tailscale HTTPS, rclone Drive 백업, NAI 큐 프로토타입.
