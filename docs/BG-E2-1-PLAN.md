# E2-1 계획 — subset 검증 harness와 독립 pack의 1.16.1 선언

**상태 (2026-10-26 KST):** 계획 작성, Astra 계획 검수 1회 반영(§6). 정본: patcher `docs/POCKETRISU-1.16-REBASE-AUDIT.md`(`9b15c32`)의 「Ordered plan」 E2-1과 「Target declaration per pack」.
**위험 분류:** risky. 여러 파일을 바꾸고, installer에 들어가는 `src/manager.cjs`와 pack target 선언(install/revert 대상 선택)을 바꾼다.

## 1. 목표

1. 1.16.1 위에서 pack 일부만 골라 적용·검사·되돌리는 maintainer용 검증 도구를 만든다. 전체 `all` graph 없이 rebase 단위마다 근거를 남기기 위해서다. 결과는 subset 근거일 뿐 qualification이 아니다.
2. 1.16.1에서 anchor가 모두 그대로 맞는 독립 pack 7개에 1.16.1을 `reviewing`으로 선언하고, 그 도구로 검증한다.

## 2. 확인한 사실

| # | 사실 | 출처 |
|---|---|---|
| F1 | `planTransition`은 `resolveSelection(catalog, packIds)`를 option 없이 부른다. 내부 pack(`userSelectable: false`)을 직접 고르면 `INTERNAL_PACK_REQUESTED`로 거부된다. `allowInternal`을 넘기는 호출자는 없다. | `src/manager.cjs:643-654`, `src/resolver.cjs:84-103` |
| F2 | 되돌리기는 별도 함수가 아니라 `planTransition({packIds: []})`이다. | `src/manager.cjs:930-954` export 목록, 탐색 보고 |
| F3 | `qualify`/`stage`는 항상 `all`을 쓰고 `--packs`를 거부한다. stage 검사는 `pnpm --version`·`install --frozen-lockfile`·`test`·`check`·`build`(+ `bg-preserve` 선택 시 bundle)이고 `test:compat`·revert·재계획은 없다. | `src/cli.cjs:84-88,172-185`, `src/staging.cjs:140-214` |
| F4 | 저장소 테스트는 실제 PocketRisu 트리를 읽지 않는다(합성 임시 트리). 실제 트리 검사는 외부 gate 스크립트뿐이다. | 탐색 보고(`test/manager.test.cjs:25-32` 등) |
| F5 | 후보 gate는 `all`을 일반 `apply`로 적용하므로 1.16.1에서는 전체 graph가 준비될 때까지 쓸 수 없다. | `~/.claude/scripts/pocketrisu-candidate-gates.sh:241` |
| F6 | unit의 `targetVersions` 버전은 pack `targets`에 선언돼 있어야 한다. | `src/manager.cjs:460-500` |
| F7 | `packEtag`는 `targets`와 `units`를 포함하므로, 선언을 바꾸면 기존 설치 상태가 바뀐 pack으로 본다. | `src/manager.cjs:68-83` |
| F8 | 7개 pack은 1.16.1에서 anchor가 모두 맞고 drift 0, 소유 경로 충돌 0이다: `charx-archive-integrity`(anchor 13·owned 5), `parser-hardening`(10·4), `fastimport-ios-picker`(2·2), `log-load-performance`(1·1), `kei-prompt-role-compat-core`(2·1), `kei-text-theme-normalization-core`(5·4), `kei-fullscreen-image-viewer-core`(8·0). | audit `anchors2.tsv` 실측(`677595c`) |
| F9 | 이 pack들이 건드리는 원본 파일 중 1.10→1.16.1에서 바뀐 것: `process/index.svelte.ts`(+264/−56)·`parser.svelte.ts`(+235/−38)·`cbs/conditionals.test.ts`(+1)(parser), `package.json`·`pnpm-lock.yaml`·`characterCards.ts`(+122/−14)(charx), `request-logs.cjs`(+17)(log), `plugins.svelte.ts`(+143/−47)(fastimport), `database.svelte.ts`(+254/−37)(prompt-role·text-theme). 그대로인 것: `chatML.ts`·그 test·`processzip.ts`·`AssetViewer.svelte`·`colorscheme.ts`. | `git diff --shortstat v1.10.0 v1.16.1` 실측 |
| F10 | `parser-hardening`은 unit 전부가 범위 없음(모든 선언 target), 나머지 6개는 unit 전부가 `['1.10.0']`로 묶여 있다. 4개는 사용자 선택 가능, Kei core 3개는 내부 pack이다. | catalog 실측 |
| F11 | catalog test가 모든 pack을 `verified: ['1.10.0'], reviewing: []`, 범위 있는 unit을 `['1.10.0']`로 고정한다. CI는 installer를 두 번 빌드해 `dist`가 깨끗한지 보고 1.10.0에 전체 graph를 적용한다. | `test/catalog.test.cjs:13-22`, `.github/workflows/ci.yml` |
| F12 | 원본 1.16.1은 Node 24에서 install·test·test:compat·check·build가 모두 exit 0이다(check 경고 4). | audit 「E2-0 result」 |

## 3. 단위

| ID | 제목 |
|---|---|
| E2-1a | Subset verification harness |
| E2-1b | Declare PocketRisu 1.16.1 for seven independent packs |

### E2-1a — Subset verification harness

**인터페이스 (고정):**

- `src/manager.cjs` `planTransition({..., allowInternal = false})`: `resolveSelection(catalog, packIds, { allowInternal })`로만 넘긴다. installer CLI와 다른 호출자는 넘기지 않는다. harness는 `persistIntent: false`로 부르고 intent를 쓰지 않는다.
- `scripts/lib/target-coverage.cjs`(maintainer 전용, catalog·manager·staging·installer가 import하지 않음): `validateTargetCoverage({ catalog, coverage, baseline, packIds })` → `{ ok, violations: [{ pack, target, kind, unitId }] }`.
- `scripts/lib/subset-closure.cjs`: `resolveSubsetClosure({ catalog, packIds, target })` → `{ packs, units }`. pack `requires`·`autoWhen`(resolver)와 unit `requires`의 소유 pack(해당 target에서 선택되는 unit 기준)을 고정점까지 번갈아 확장한다. 소유 pack이 없거나 둘 이상이면 `SUBSET_UNIT_OWNER` 위반으로 멈춘다.
- `scripts/qualify-subset.cjs --root <사본> --packs <id,...> --out <폴더> [--json]`, 내부 진입 함수 `runSubsetQualification({ root, packIds, catalog, coverage, baseline, outDir, checkRunner, env, now })`. `env`는 기본 `process.env`이고 `NODE_OPTIONS`를 여기서 읽는다. `checkRunner(check, root) → { exitCode, stdoutTail, stderrTail }`는 테스트에서 주입한다.
- `patches/target-coverage.cjs`: coverage 데이터. `test/fixtures/target-baseline-1.10.0.json`: 변경 전(`9b15c32`) catalog에서 1.10.0에 선택되는 pack별 unit id 목록과 pack 선언·unit의 정규화 해시. 이 파일은 E2-1a에서 한 번 만들고 이후 단위가 바꾸지 않는다.

**harness 순서 (한 lock 안에서):**

1. 사전 검사: root가 git checkout이고 tracked 변경이 없다. patch state·intent·journal·lock 파일이 없다. closure의 모든 owned 경로가 없다(ignored 포함). `package.json`의 `packageManager`가 `checkRunner`로 실행한 `pnpm --version`(단계 이름 `pnpm-version`, preflight에 속함)의 출력과 같다. `node -v`, `pnpm -v`, `NODE_OPTIONS`를 기록하고, `NODE_OPTIONS`에 `--no-experimental-webstorage`가 없으면 멈춘다(후보 gate와 같은 환경).
2. closure 해석(`resolveSubsetClosure`), closure의 모든 pack이 target을 `verified`·`reviewing`으로 선언했는지, coverage 검사.
3. 사전 스냅숏: closure의 모든 managed·owned 경로의 존재·bytes 해시·mode.
4. plan(`allowInternal: true`, `persistIntent: false`) → `applyTransition({ lockHeld: true })` → `status`가 `current` → 같은 선택 재계획 시 변경 0. 이 시점의 증거(선택 unit id와 순서, pack etag, 파일 해시·mode, state 해시)를 receipt에 먼저 쓴다.
5. `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm test:compat`, `pnpm check`, `pnpm build`, closure에 `bg-preserve`가 있으면 `node server/node/bgOrchBundle.build.cjs`. 첫 실패에서 남은 검사 단계를 건너뛰고 `skipped`로 기록한다.
6. 검사 뒤 managed 상태 `current`, tracked 변경 집합이 4단계 직후와 같다.
7. 되돌리기(`packIds: []`, `lockHeld: true`). 그 뒤 state·intent·journal이 없고, 3단계 스냅숏의 경로마다 존재·bytes·mode가 같고, tracked 변경이 없다. untracked·ignored 중 판정에서 빼는 것은 `node_modules/`, `dist/`, bundle 산출물(`server/node/bgOrchBundle.{css,mjs}`)처럼 이름으로 지정한 산출물뿐이다.
8. lock을 놓은 뒤 lock 파일이 없는지 확인한다.

**실패 처리:** 처음 실패한 단계와 코드를 `failure`로, 정리 시도 결과를 별도 `cleanup`으로 기록한다. apply 뒤 실패면 정상 되돌리기를 한 번 시도한다. 되돌리기가 drift로 거부되면 트리를 그대로 두고 `cleanup: "preserved-drift"`로 끝낸다(강제 복원 금지). apply 전 실패면 트리를 건드리지 않는다.

**receipt (`<out>/receipt.json`):** `qualification: false`, target(이름·버전·원본 commit은 root의 `git rev-parse HEAD`), patcher revision(`git rev-parse HEAD`와 dirty 여부), 요청·해석 pack과 버전·etag, 선택 unit id와 순서, coverage 결과, 파일 해시·mode, 각 단계의 명령·종료 코드·소요·로그 경로, 환경(node·pnpm·`NODE_OPTIONS`), `failure`·`cleanup`. A4 실측은 실행마다 원본 캐시의 새 사본을 쓴다.

**coverage 규칙:**

- 데이터: `{ [pack]: { [target]: { from: '1.10.0', retained: [ids] | 'all', replaced: { 옛id: [새id, ...] } (이유 없음), added: { 새id: 이유 }, retired: { 옛id: 근거 } } } }`. 분할은 `replaced` 값 배열로, 병합은 여러 옛 id가 같은 새 id를 가리키는 것으로 표현한다.
- 옛 목록은 현재 catalog가 아니라 `target-baseline-1.10.0.json`에서 읽는다.
- 위반: 기준선의 옛 id가 세 범주 중 정확히 한 곳에 있지 않음, 알 수 없는 옛 id, 범주 간 중복, `retained` 안 중복, `added` 키와 `replaced` 값의 중복, 빈 이유·근거, 새 target에서 선택되는 unit 집합 ≠ `retained ∪ replaced 값 ∪ added`, 1.10.0 밖 target을 선언했는데 항목 없음.
- 같은 검사기가 catalog test와 harness 2단계에 쓰인다.

### E2-1b — 7개 pack 선언

- 7개 pack의 `targets.pocketrisu.reviewing`을 `['1.16.1']`로 바꾼다. 범위 있는 unit 전부의 `targetVersions`를 `['1.10.0', '1.16.1']`로 넓힌다(`parser-hardening`은 unit을 바꾸지 않는다). 각 pack version을 patch 단위로 올린다(F7).
- `patches/target-coverage.cjs`에 7개 pack의 1.16.1 항목(`retained: 'all'`)을 넣는다.
- `test/catalog.test.cjs:13` 검사를 바꾼다: `reviewing: ['1.16.1']`인 pack은 정확히 이 7개다. 나머지 38개 pack의 선언·unit 해시가 기준선과 같다. 모든 pack에서 1.10.0에 선택되는 unit id 목록이 기준선과 같다.
- 의미 검토(Astra 2026-10-26, 확인 대상): 바뀐 원본 파일의 삽입 위치에서 동작이 달라진 곳은 없었다. `fastimport-ios-picker`는 1.16.1의 저장소 초기화·preload 게이트(`plugins.svelte.ts:492`)와 함께, preload 실패 시 변환된 V2 plugin이 계속 비활성인지 테스트로 확인한다. 1.10.0 적용 결과를 바꾸지 않도록 이 테스트는 1.16.1 전용 새 owned unit(`src/ts/plugins/fastImportIOSPicker.preload.test.ts`, coverage `added`)으로 넣는다.
- `charx-archive-integrity`의 zip 라이브러리 이중화는 바꾸지 않는다. frozen install은 A4에서 본다.

각 단위의 commit에 patcher version(`0.2.4-experimental.89`, `.90`), CHANGELOG, `dist` 재빌드를 넣고, 각 commit 직전에 1.10.0 후보 gate를 돌린다.

## 4. 바뀌면 안 되는 것

- 1.10.0에서 선택되는 unit과 적용 결과 source bytes·mode: pack마다 기준선과 같다. 후보 gate(1.10.0)가 직전 기준(19/19)과 같다.
- 예외(의도한 metadata 변화): 7개 pack의 version·etag가 바뀌므로, 옛 installer로 1.10.0에 적용한 설치는 새 CLI `status`에서 이 7개가 `update-available`로 보이고, 첫 reapply는 source를 바꾸지 않고 state metadata만 갱신한다.
- 일반 installer의 `apply`·`stage`·`plan`·`revert`·`status`는 `allowInternal`을 쓰지 않는다. `qualify`는 계속 `all`만 다룬다.
- 다른 38개 pack의 선언과 unit.
- live와 사용자 데이터. 이 단위는 원본 사본만 쓴다.

## 5. 수용 기준과 검사

| # | 기준 | 검사 |
|---|---|---|
| A1 | `planTransition({allowInternal: true})`는 내부 pack 직접 선택을 받고, 기본값은 지금처럼 거부한다. intent를 쓰지 않는다. | 저장소 테스트 |
| A2 | harness는 사전 검사 위반 각각, closure 미선언·소유 pack 없음/중복, coverage 위반, apply 뒤 `current` 아님, 재계획 변경, pnpm 단계 실패, 검사 중 drift, 되돌린 뒤 잔여(경로·bytes·mode·metadata·lock)를 각각 실패로 판정하고 receipt에 `failure`·`cleanup`을 남긴다. | 저장소 테스트(합성 트리, check runner 주입) |
| A3 | coverage 검사기가 위 위반 목록을 각각 잡고, 분할·병합·추가·은퇴가 맞게 적힌 데이터는 통과시킨다. | 저장소 테스트 |
| A4 | 7개 pack 각각과 7개 묶음을 1.16.1 원본의 새 사본에 harness로 돌려 모든 단계가 통과한다. | `scripts/qualify-subset.cjs` 실측(Node 24, gate와 같은 `NODE_OPTIONS`) |
| A5 | 각 commit에서 1.10.0 후보 gate 결과가 직전 기준과 같다. | `pocketrisu-candidate-gates.sh <worktree> <out>` |
| A6a | 일반 apply 경로는 `reviewing`만 선언된 target을 거부한다(`TARGET_REVIEW_REQUIRED`). | 저장소 테스트(조합 가능한 주입 catalog) |
| A6b | 실제 installer를 원본 1.16.1 사본에 `apply`하면 실패하고, managed source·patch state가 바뀌지 않는다. 실패 코드는 고정하지 않는다(미완 graph라 조합 오류가 먼저 날 수 있음). 진단 보고서 파일 생성은 허용한다. | 실측 |
| A7 | 옛 catalog로 1.10.0에 적용한 상태에 새 catalog를 쓰면: source bytes·mode 그대로, 7개 pack이 `update-available`, reapply는 metadata만 바꾸고, 그 뒤 재계획 변경 0. | 저장소 테스트(합성 트리) |
| A8 | 1.10.0 기준선 고정: 모든 pack의 1.10.0 선택 unit이 기준선과 같고, 38개 pack의 선언·unit 해시가 같다. | 저장소 테스트 |

### Test contract

| 기준 | 입력 | 기존 상태 | 기대 | 범위 밖 |
|---|---|---|---|---|
| A1 | 내부 pack id 하나로 plan | 합성 root, pack이 target 선언 | `allowInternal: true`면 성공, 기본값이면 `INTERNAL_PACK_REQUESTED`, intent 파일 없음 | CLI 인자 |
| A2 | 실패 조건 하나씩 만든 합성 root, 주입 runner | git checkout(조건 제외) | 해당 단계에서 멈춤, 이후 단계 `skipped`, `failure`·`cleanup` 기록, apply 전 실패는 root 무변경, apply 뒤 실패는 정상 되돌리기 시도, drift면 `preserved-drift` | 실제 pnpm, 네트워크 |
| A2 | 성공하는 합성 root | 동일 | `qualification: false`, 모든 단계 pass, 끝에 사전 스냅숏과 같음, lock 없음 | — |
| A3 | coverage 데이터 변형(누락·중복·초과·알 수 없는 id·빈 이유·항목 없음, 정상 분할·병합) | 합성 catalog와 기준선 | 위반은 각각 kind·unitId로 보고, 정상 데이터 통과 | 실제 catalog 내용(A8) |
| A6a | 일반 apply, reviewing 선언만 있는 조합 가능 catalog | 합성 root | `TARGET_REVIEW_REQUIRED`, source·state 무변경 | 실제 1.16.1 graph |
| A7 | 옛 manifest(version·targets 이전)로 apply한 state, 새 catalog | 합성 root, 1.10.0 | 위 A7 기대 | 실제 live |
| A8 | 실제 catalog | `test/fixtures/target-baseline-1.10.0.json` | 같음 | — |

### 전제 출처

| 전제 | 출처 |
|---|---|
| 내부 pack 거부, option 없는 호출 | 코드 `src/manager.cjs:654`, `src/resolver.cjs:97` (확인함) |
| 되돌리기 = 빈 선택 | 코드 `src/cli.cjs:177-178`(`customIntent([])`), manager export에 revert 함수 없음 (확인함) |
| stage 검사 목록, pnpm 버전 검사 | 코드 `src/staging.cjs:140-214` (확인함), 원본 `package.json:5` `pnpm@10.34.1` (확인함) |
| 동일 내용 owned 파일 수용·되돌릴 때 삭제 | 코드 `src/compose.cjs:123-125,174` (확인함) |
| state 없으면 `clean` | 코드 `src/manager.cjs:894` (확인함) |
| `update-available` 표시 | 코드 `src/cli.cjs:530-538` (확인함) |
| unit `requires` 미해결 시 `MISSING_DEPENDENCY` | 코드 `src/compose.cjs:307-314` (확인함) |
| 7개 pack anchor·충돌 | 실측 `anchors2.tsv`(`677595c`), Astra 메모리 조합 실측 58 unit·충돌 0, `git diff 677595c..HEAD -- patches src` 빈 결과 |
| 원본 1.16.1 기준값 | 실측 E2-0, Node 24.22.1 |

## 6. 계획 검수

Astra(gpt-6-astra, 2026-10-26) 1회. 지적 7건을 모두 반영했다: unit 단위 의존 closure, 1.10.0 기준선 고정과 coverage 검증 규칙, owned 경로·metadata 사전/사후 검사, 한 lock과 실패 정리 규칙, receipt 증거와 pnpm·환경 검사, A6 분리, 옛 상태 → 새 catalog 업그레이드 테스트. 7개 pack의 의미 검토는 결함을 찾지 못했고 `fastimport-ios-picker` preload 실패 테스트 하나를 추가했다.

## 7. 진행 흐름

Argon 시나리오(public 저장소) → Codex 테스트 작성(E2-1a·b 한 번에, 인터페이스는 이 계획에 고정) → `opus-implementer` → Codex 코드 검수 → gate(각 commit의 1.10.0 후보 gate, A4·A6b 실측) → commit 2개. push는 사용자 확인 뒤.
