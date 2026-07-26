# Runtime cycle reduction WIP

> 상태: S0~S4 구현·source/production 자동검증 완료. runtime-static SCC reachable 목표 0을 달성했다. 기능 통합의 사용자 L3 답변과 독립적으로 진행했으며 실제 사용자 L3만 남았다.

## 목표와 판정 기준

- raw madge path 수는 회귀 참고값이고 완료 판정에 단독 사용하지 않는다.
- 정본 지표는 TypeScript 변환 후 남은 static runtime graph의 SCC 크기, SCC 내부 edge, direct mutual pair다.
- 목표는 import 이름 변경이나 dynamic import로 수치를 숨기는 것이 아니라 module evaluation 방향을 단방향화하는 것이다.
- reachable 완료 목표는 runtime-static SCC 0, direct mutual pair 0이다. 보존 비용 때문에 불가피한 고리가 확인되면 top-level 안전 근거·제거 비용·실제 잔여 지표를 적고 사용자 승인 전에는 완료로 처리하지 않는다.
- 같은 회귀를 두 번 못 잡거나 DI adapter가 계속 불어나면 구현을 멈추고 동작 구조·틀린 설계 가정·대안 영향면을 먼저 다시 검토한다.

## S0 — 정본 측정기 (완료)

- `scripts/audit-cycles.mjs`가 madge raw graph와 TypeScript 변환 후 static import/export graph를 함께 분석한다.
- 고정 schema: `rawPaths`, `rawSccSizes`, `runtimeSccSizes`, `runtimeInternalEdges`, `runtimeDirectPairs`, SCC members/edges, mutual pairs.
- fixture는 type-only 제거, dynamic import 제외, 실제 2-node static cycle 검출을 확인한다.
- v5 통합 직후 관찰 baseline: source 143 modules, raw 71 paths / SCC `[39,2,2]`, runtime SCC `[31,2,2]`, 내부 edge 104, direct pair 21.

## S1 — React UI back-edge (완료)

- `SceneEditor ↔ PreSetEditor`: 프리셋 에디터 컴포넌트를 `SceneQueueControl` 조립 지점에서 주입했다. scene/preset editor의 기존 props와 render 시점은 유지했다.
- `SceneQueueControl ↔ ResultViewer`: 결과 뷰어 내부 inpaint queue 컴포넌트를 상위 조립 지점에서 주입했다. 결과 뷰어가 queue module을 역import하지 않는다.
- 단계 관찰: `[31,2,2] / 104 / 21` → 첫 고리 `[31,2] / 102 / 20` → 둘째 고리 `[31] / 100 / 19`. TypeScript 검사 통과.
- 남은 L3: scene/preset 편집, 모바일 상세설정 FloatView, 결과 viewer 열기/닫기, 내부 inpaint 탭, 이미지 이동·선택.

## S2 — `models/index.ts` 역참조 제거 (완료)

1. backend-only store와 backend+image/session 조합 서비스가 constructor로 필요한 dependency를 받도록 전환했다.
2. `ImageService`의 대표 이미지·삭제 facade, Prompt/Session/TaskQueue/legacy runtime을 명시적 install+fail-fast port로 분리했다. `models/index.ts`는 인스턴스 조립과 설치 순서만 소유한다.
3. Session 자동 저장 시작은 모든 runtime 설치 뒤로 옮겼고, 기존 load·생성·휴지통·템플릿·프로젝트 rename 순서는 보존했다.
4. 단계 관찰: `[31] / 100 / 19` → `[25] / 84 / 16` → `[23] / 74 / 8` → `[16] / 54 / 8` → `[13] / 39 / 6` → `[12] / 34 / 5` → `[12] / 33 / 4` → `[12] / 31 / 2` → `[9] / 22 / 1`.

## S3 — 순수 model/type와 materialization 분리 (완료)

- `types.ts`가 `models/index.ts`를 import하지 않고 설치된 `WorkflowCodec`으로 preset/shared/session을 materialize한다. 다른 codec 재설치와 미설치 실행은 fail-fast한다.
- ResourceSync/Session/legacy migration도 composition root에서 설치된 동일 서비스 인스턴스를 사용한다.
- 구버전 project JSON, preset/shared deserialize, scene import, full backup restore의 기존 호출 경로를 유지했고 전체 source test에 포함해 검증했다.

## S4 — AppService와 queue/workflow 방향 분리 (완료)

- queue/workflow/legacy/cycling/download의 `AppService` 직접 참조를 `appStateRef`의 좁은 UI port로 바꿨다.
- SD/Augment/OneTime workflow는 공용 `workflowRuntime` leaf에서 image/queue/prompt/workflow dependency를 받고 AppService와 index를 역import하지 않는다.
- 단계 관찰: `[9] / 22 / 1` → workflow 분리 `[4] / 5 / 0` → cycling/download UI port 분리 `[] / 0 / 0`.
- 최종 자동검증: source 145 modules, raw 18 paths / raw SCC `[22,7]`, runtime SCC `[]`, 내부 edge 0, direct pair 0, TypeScript 오류 0, source test 32/32, cycle fixture 통과, server syntax 통과.
- raw SCC는 TypeScript가 제거하는 type-only edge를 포함하므로 runtime 완료 판정과 분리한다. dynamic import를 새 은닉 수단으로 추가해 수치를 낮추지 않았고, runtime 설치 port는 단일 composition root·재설치 거부·미설치 fail-fast 계약을 가진다.

## 현재 게이트 상태

- source 테스트·tsc·cycle 측정을 통과했다.
- source L2.5는 `.code-review/runtime-audit-2026-07-22-sdstudio-v5-cycle.md`에 완료했다.
- checkpoint `6abf3bb`, root `update.sh` production build, PM2 재시작, 새 번들 대상 L2를 통과했다.
- 실제 사용자 L3와 그 OK 뒤 stable release는 아직 수행하지 않았다.
