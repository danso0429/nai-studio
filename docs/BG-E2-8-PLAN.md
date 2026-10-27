# E2-8 계획 — 의존 adapter를 PocketRisu 1.16.1로

**상태 (2026-10-27 KST):** 초안. 대상·부모·순서를 정했다. 단위별 수용 기준 표는 부모 단위가 끝난 뒤 채운다. 정본: patcher `docs/POCKETRISU-1.16-REBASE-AUDIT.md`의 「Ordered plan」 E2-8 행.
**위험 분류:** 단위마다 정한다. owned 파일만 가진 Kei core는 선언과 coverage만 바꾸므로 normal 후보이고, 원본 파일이나 BG·lazy 글귀에 붙는 adapter는 risky다.

## 1. 목표

부모 pack이 1.16.1로 옮겨진 뒤, 그 부모에 붙는 adapter와 Kei core를 하나씩 1.16.1 전용 계약(E2-2 계획 「공통 계약」)으로 옮긴다. 부모보다 먼저 옮기지 않는다.

## 2. 확인한 사실

출처: orchestrator 집계(catalog 전체 unit을 pristine 1.10.0·1.16.1과 비교, 로컬 `e2/anchors2.tsv`)와 catalog의 `requires`·`autoWhen`·`targets`(2026-10-27, patcher `7336c26`).

| pack | unit | 1.16.1 anchor (맞음/바뀜/없음/owned/다른 pack 파일) | `requires` | 부모 단위 |
|---|---|---|---|---|
| `kei-stream-parser-core` | 4 | owned 4 | - | 없음 |
| `kei-chat-render-core` | 2 | owned 2 | - | 없음 |
| `kei-mobile-navigation-core` | 4 | owned 4 | - | 없음 |
| `kei-hypa-tools-core` | 4 | owned 4 | - | 없음 |
| `kei-partial-edit-core` | 4 | owned 4 | - | 없음 |
| `kei-translation-tools-core` | 10 | owned 10 | - | 없음 |
| `pocketrisu-kei` | 0 | - | Kei core 10개 | 위 core와 E2-1c·E2-6c의 core |
| `kei-stream-parser-bg-adapter` | 4 | 4/0/0/0/0 | core, `bg-preserve` | E2-7a |
| `kei-chat-render-bg-adapter` | 16 | 11/5/0/0/0 | core, `bg-preserve` | E2-7a |
| `kei-hypa-tools-bg-adapter` | 18 | 18/0/0/0/0 | core, `bg-preserve` | E2-7a |
| `kei-partial-edit-bg-adapter` | 14 | 9/3/2/0/0 | core, `kei-chat-render-bg-adapter`, `bg-preserve` | E2-7a |
| `kei-translation-tools-bg-adapter` | 46 | 38/7/1/0/0 | core, `kei-chat-render-bg-adapter`, `bg-preserve` | E2-7a |
| `kei-mobile-navigation-lazy-adapter` | 36 | 27/9/0/0/0 | core, `lazy-chat-sync` | E2-3 |
| `haejeok-chat-width-adapter` | 16 | 11/1/2/2/0 | `personal-settings` | E2-4d |
| `personal-settings-lazy-session-adapter` | 2 | 0/0/0/0/2 | `personal-settings`, `lazy-chat-sync` | E2-4d, E2-3 |
| `haejeok-persistence-safety-adapter` | 53 | 41/2/6/4/0 | `bg-preserve`, `lazy-chat-sync` | E2-7 |
| `client-build-fence-bg-adapter` | 11 | 0/0/0/0/11 | `client-build-fence`, `bg-preserve` | E2-7a |

- 다른 단계가 맡는 adapter: `haejeok-korean-search-adapter`(E2-4b), `client-build-fence-lazy-session-adapter`·`client-build-fence-kei-adapter`·`client-build-fence-kei-lazy-storage-adapter`(E2-6d), `kei-backup-restore-safety-core`·`-lazy-adapter`(E2-6c), `server-backup-snapshot-lazy-adapter`(E2-6b), `pagefold-bg-adapter`(E2-5b에서 retire).
- E2-1c에서 이미 옮긴 Kei core: `kei-fullscreen-image-viewer-core`, `kei-prompt-role-compat-core`, `kei-text-theme-normalization-core`.
- 「다른 pack 파일」은 부모 pack이 owned로 만드는 파일을 고치는 unit이다. 부모의 그 파일이 바뀌지 않으면 그대로 맞는다.

## 3. 판정

| 대상 | 판정 | 근거 |
|---|---|---|
| owned만 가진 Kei core 6개 | 선언과 coverage만 바꾸고(`retained`), owned 파일이 1.16.1 조립 트리에서 type check·test를 통과하는지 확인한다. 부모가 없어 E2-7을 기다리지 않는다 | 표, E2-1c 선례 |
| `pocketrisu-kei` | Kei core 10개가 모두 1.16.1을 선언한 뒤 선언을 바꾼다 | `requires` |
| BG adapter(Kei 5개, fence 1개) | E2-7a 뒤 부모별로 옮긴다. 바뀐·없는 anchor는 1.16.1 글귀로 같은 id에서 고친다 | 표 |
| lazy adapter(`kei-mobile-navigation-lazy-adapter`) | E2-3 뒤. `lazy-chat-sync` 1.10 글귀에 붙은 unit은 E2-3 unit 글귀나 원본 글귀로 다시 쓴다 | 표 |
| personal-settings adapter 2개 | E2-4d 뒤 | 표 |
| `haejeok-persistence-safety-adapter` | E2-7 뒤. 이 pack이 `after`로 가리키는 retire한 pack id(PageFold, organizer)는 손대지 않는다(무시되는 문자열, E2-4 G5) | 표, E2-5 M10 |

## 4. 단위 (초안)

| ID | 제목 |
|---|---|
| E2-8a | Declare the owned-only Kei cores for PocketRisu 1.16.1 |
| E2-8b | Rebase the Kei mobile navigation lazy adapter |
| E2-8c | Rebase the personal-settings adapters |
| E2-8d | Rebase the Kei BG adapters |
| E2-8e | Rebase the fence BG adapter |
| E2-8f | Rebase the Haejeok persistence safety adapter |
| E2-8g | Declare the pocketrisu-kei bundle for PocketRisu 1.16.1 |

- 순서: E2-8a는 언제든(부모 없음). E2-8b는 E2-3 뒤, E2-8c는 E2-4d 뒤, E2-8d·E2-8e는 E2-7a 뒤, E2-8f는 E2-7 뒤, E2-8g는 E2-8a와 E2-6c 뒤.
- 각 단위는 E2-2 「공통 계약」과 E2-4 계획 §4의 계산된 `after` 규칙을 따르고, 손댄 pack과 부모의 closure로 subset harness를 돌린다.

## 5. 바뀌면 안 되는 것

- 부모 pack의 unit과 동작. adapter는 부모 위에서만 동작을 더한다.
- Kei 기능의 1.10 동작(fullscreen viewer, stream parser, chat render, mobile navigation, HypaMemory tools, partial edit, translation tools)과 저장값.
- 일반 installer는 `reviewing`만 선언된 target을 거부한다.

## 6. 수용 기준과 테스트 계약

공통: C0-C2(E2-4 계획과 같음). 단위별 표는 부모 단위가 끝난 뒤 그 부모의 1.16.1 글귀를 보고 채운다. E2-8a는 core마다 「1.16.1 조립 트리에서 owned test가 통과하고 기존 1.10 동작 test가 그대로 통과」를 기준으로 한다.

## 7. 다음

E2-8a의 전제 확인(owned 파일이 1.16.1 원본 module을 import하는 자리)과 계획 검수, 그 뒤 부모 순서대로 단위별 표.
