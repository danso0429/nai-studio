# E2-9 계획 — 전체 조립 검증과 cutover 리허설

**상태 (2026-10-27 KST):** 초안. 정본: patcher `docs/POCKETRISU-1.16-REBASE-AUDIT.md`의 「Ordered plan」 E2-9 행과 위험 표 3·5번.
**위험 분류:** risky. target 승격, installer, 사용자 데이터 migration 리허설을 다룬다. 실제 live cutover는 이 계획 밖이며 별도 계획과 사용자 승인으로 한다.

## 1. 목표

E2-1부터 E2-8까지 옮긴 pack 전체를 1.16.1에서 한 graph로 조립·검증하고, 그 결과로만 `reviewing`을 `verified`로 올린다. live 데이터 사본으로 migration과 되돌리기를 리허설해 cutover 계획의 입력을 만든다.

## 2. 확인한 사실

| # | 사실 | 출처 |
|---|---|---|
| F1 | 새 CLI는 target 확인 전에 남은 patch journal을 복구한다. `status`에서도 그렇다(`src/cli.cjs:525`, `src/manager.cjs:441`). 1.10 journal이 남아 있으면 1.16.1 파일에 1.10 내용을 쓸 수 있다. | audit E2-9 행(확인함 표기) |
| F2 | custom state 채택은 알려진 owner와 `RETIRED_OWNER_IDS`만 받는다(`src/catalog.cjs:107-125`). E2에서 retire한 pack(`toolchain-hardening`, `fastimport-ios-picker`, `character-organizer`, `pagefold-model-preset`, `pagefold-bg-adapter`)이 모두 그 목록에 있어야 한다. | 확인함(E2-4·E2-5 계획) |
| F3 | 1.11에서 plugin storage가 DB blob 밖으로 옮겨졌고, 1.11 release note는 1.10 binary로 돌아가면 옮겨진 plugin 데이터를 쓸 수 없다고 경고한다. | audit 위험 표 3번 |
| F4 | 정확한 source revert는 데이터 되돌리기가 아니다(lazy journal, plugin storage migration). | audit 위험 표 3번 |
| F5 | E2-2b에서 snapshot core를 떠난 compat 테스트 4개(`backup-point-in-time`, `storage-reset-b1a`, `session-reset-b2`, `reset-orphans-b3`)는 E2-3·E2-6·E2-7에서 owner 아래로 돌아간다. 전체 graph에서 모두 통과해야 한다. | audit E2-2 행, E2-3c c9 결정 |
| F6 | 후보 gate 스크립트 `~/.claude/scripts/pocketrisu-candidate-gates.sh`는 기본 target이 1.10.0이고 `--tag`/`--commit`으로 다른 target을 받는다. E2 동안 이 gate는 쓰지 않고 subset harness를 썼다. | CLAUDE.md, E2-3 test task |

## 3. 판정

| 대상 | 판정 | 근거 |
|---|---|---|
| 전체 graph 검증 | 1.16.1 pristine에서 `all` profile apply → current → reapply → exact revert, 그리고 후보 gate 스크립트를 `--tag v1.16.1`(또는 `--commit 5da95f7`)로 실행한다 | audit E2-9 |
| target 승격 | 전체 graph 검증, L4, 결정적 installer(두 번 빌드 동일) 뒤에만 각 pack의 `reviewing: ['1.16.1']`을 `verified`로 옮긴다. 1.10.0 선언은 이때 함께 정리한다(별도 판정) | audit 위험 표 5번 |
| BG 재검증 | 1.10에서 통과한 BG 검증(D2/D3 실제 memory plugin 포함)을 1.16.1에서 다시 돈다 | audit E2-9 |
| migration 리허설 | live 1.10 데이터의 사본에서: 쓰기·job 정지 → lazy chat journal 정리 → 일관된 cutover 전 backup → 원본 1.16 migration → retire한 pack이 쓴 데이터 확인 → 데이터+코드 되돌리기와 cutover 뒤 받은 쓰기의 처리 규칙 시험 | F3, F4 |
| 옛 installer 정리 | source를 1.16.1로 옮기기 전에 옛 installer의 revert가 성공하고 patch journal·state·intent·lock이 남지 않아야 한다. 리허설에서 이를 확인하는 절차를 만든다 | F1 |
| L5 | 전체 graph 후보로 iPhone L5를 한 세션에 모아 기능별 시나리오와 결과를 남긴다(CLAUDE.md L5 규칙) | CLAUDE.md |

## 4. 단위 (초안)

| ID | 제목 |
|---|---|
| E2-9a | Verify the complete 1.16.1 graph and installers |
| E2-9b | Repeat the BG verifications on 1.16.1 |
| E2-9c | Rehearse the data migration and rollback on a live-data copy |
| E2-9d | Promote the 1.16.1 declarations to verified |

- 순서: E2-9a → E2-9b → E2-9c → L4 → L5 → E2-9d. 승격은 L5 뒤다.
- E2-9c는 live 데이터의 사본만 쓴다. live 설치와 그 PM2 process는 건드리지 않는다. 사본을 만드는 일과 그 크기·위치는 실행 전에 사용자에게 확인한다.

## 5. 바뀌면 안 되는 것

- live PocketRisu, PM2, 사용자 데이터. push, tag, release, live cutover는 이 계획에서 하지 않는다(별도 승인).
- 1.10.0 graph(승격 전까지).

## 6. 수용 기준

| # | 단위 | 기대 결과 |
|---|---|---|
| a1 | E2-9a | `all` profile apply·current·reapply·exact revert가 1.16.1에서 통과하고 revert 뒤 변경 0 |
| a2 | E2-9a | 후보 gate 스크립트가 1.16.1 target에서 `RESULT: PASS` |
| a3 | E2-9a | F5의 compat 테스트 4개가 전체 graph에서 통과 |
| a4 | E2-9a | `RETIRED_OWNER_IDS`가 F2의 다섯 id를 모두 가진다 |
| b1 | E2-9b | 1.10에서 통과한 BG 검증 목록이 1.16.1에서 통과(목록은 BG 정본 문서에서 옮김) |
| c1 | E2-9c | 사본에서 migration 뒤 원본 기능과 pack 기능이 기존 데이터를 그대로 읽는다 |
| c2 | E2-9c | 데이터+코드 되돌리기 절차가 사본에서 동작하고, cutover 뒤 받은 쓰기의 처리 규칙이 문서로 남는다 |
| c3 | E2-9c | 옛 installer revert 뒤 journal·state·intent·lock이 남지 않음을 확인하는 절차가 있다 |
| d1 | E2-9d | L5 결과가 기록된 뒤에만 `verified`로 옮기고, 일반 installer가 1.16.1을 받는다 |

## 7. 다음

E2-8까지 끝난 뒤 이 초안을 다시 확인하고 계획 검수(Astra)를 받는다. live cutover는 별도 계획이다.
