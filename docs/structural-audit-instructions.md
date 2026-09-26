# Codebase Structural Audit

> **Status:** current canon. The L3 gate in `AGENTS.md` and `CLAUDE.md` applies this document to the change under review.

Perform an evidence-based audit of code structure and test quality before broad refactoring. Identify concrete ways the current structure makes behavior difficult to understand, verify, modify, or maintain.

The objective is useful, proportionate improvement. Finding no significant problems, retaining an existing design, or deferring a change can be valid outcomes. Do not manufacture findings to satisfy the checklist.

### 1. Establish scope and execution mode

Use the current request and existing authorization to determine whether the task is audit-only or includes implementation.

- For audit-only work, investigate and report without changing maintained source, tests, or configuration. Temporary diagnostic work must not remain as an unintended repository change.
- When implementation is already authorized, produce findings before major changes, then proceed within that authorization. Do not repeatedly request approval for routine steps already covered by it.
- Resolve routine investigative choices independently. Seek clarification only when unresolved intent or authorization materially affects the work and cannot be established from available context.

For a repository-wide audit, survey the major subsystems first, then investigate selected areas in depth. For a targeted task, inspect the affected area and relevant dependencies; do not automatically expand it into an exhaustive repository audit.

When code changes again after an audit, for example after a failed user check, re-audit the difference between the previously audited state and the new state, together with the callers, state, and tests that difference touches. Do not repeat the full audit unless the change alters structure the earlier audit relied on.

Record the repository state being examined, scope, relevant constraints, and access limitations. Distinguish maintained code from generated or third-party code; inspect the latter when relevant, but direct fixes to the appropriate source or configuration.

This is a structural and maintainability audit. Do not imply that it constitutes a complete security, performance, or functional-correctness assessment.

### 2. Understand the system and select investigation targets

Map the major execution flows, module boundaries, important state, external effects, and dependencies. Include failure paths and asynchronous lifecycle behavior where relevant.

Use this overview to select deeper investigations based on critical user flows, shared state, external boundaries, change frequency, known failures, and suspicious dependencies. Use available design records, change history, and incident information to understand constraints; frequent changes alone do not establish poor design.

For important or suspicious functions, determine as needed:

- callers, callees, and indirect invocation mechanisms;
- inputs, outputs, and relevant contracts;
- state read or mutated, including ownership and lifetime;
- external side effects and ordering requirements;
- errors produced, transformed, retried, or suppressed;
- actual responsibilities;
- tests that exercise and assert the relevant behavior.

Do not infer purpose from names alone or require exhaustive documentation of every function. Distinguish areas surveyed, areas traced in depth, and areas not examined.

### 3. Audit production structure

Use the following as investigation prompts, not mandatory findings:

- tangled or difficult-to-follow control flow;
- unrelated responsibilities combined in one function or module;
- hidden coupling, circular dependencies, or dependence on another module's internals;
- duplicated business rules or competing implementations of the same concept;
- unnecessary indirection or excessively fragmented call chains;
- inappropriate shared mutable state or unclear ownership;
- implicit ordering, initialization, or lifecycle dependencies;
- dead or apparently unreachable code;
- obsolete compatibility paths;
- misleading names or interfaces that conceal consequential side effects;
- duplicated, inconsistent, swallowed, or misplaced error handling;
- repeated local patches suggesting a missing shared abstraction;
- abstractions that no longer fit actual behavior.

Do not classify code as problematic merely because it is large, old, unconventional, or violates a generic style heuristic. Establish a concrete correctness, comprehension, verification, or change cost.

Distinguish shared business rules from superficially similar implementations that may legitimately evolve independently. Evaluate both the cost of keeping duplication and the coupling introduced by consolidation.

### 4. Validate suspected problems

Trace references, callers, data flow, configuration, and relevant failure paths far enough to assess the suspected problem and its impact. Use appropriate search, symbol navigation, static analysis, or focused execution; account for each method's limitations.

Separate:

- observed facts supported by identifiable code or execution results;
- inferences supported by those facts;
- unresolved questions requiring further evidence.

For significant findings, consider plausible reasons for the existing design and evidence that could contradict the initial diagnosis. Do not invent historical intent when records are unavailable.

Treat every inference as a hypothesis to be checked. Before the report is final, verify each inference that a finding, priority, or recommendation depends on, by tracing the code further or by focused execution such as a harness, fault injection, instrumentation, or reproduction. Record whether it was confirmed or refuted and by what evidence. An inference that cannot be verified stays labeled unverified, with the reason and the specific trace or measurement that would settle it; it must not set priority or justify a change on its own. Tangled or hard-to-follow code is not a reason to leave an inference unchecked: trace it fully, and treat the tracing difficulty itself as evidence for a comprehension-cost finding.

Show how the structure affects an identifiable behavior, failure, or realistic change scenario. A demonstrated maintenance obstacle can justify a finding without a reproduced bug; hypothetical consequences must be verified as above or remain labeled unverified.

Do not equate missing static references with unused code. Before recommending removal, check applicable dynamic registration, configuration, framework conventions, command entry points, public consumers, supported versions, and persisted-data compatibility. If usage cannot be established, retain the uncertainty rather than declaring the code dead.

Distinguish isolated complexity from complexity that propagates across boundaries. Consider both reach and actual maintenance burden when deciding whether a change is worthwhile.

Group symptoms under a common cause only when evidence supports that relationship.

### 5. Audit test protection

Determine which behaviors and failure modes important tests protect, including whether their assertions would detect a relevant regression. Executing a line is not the same as verifying its behavior.

Investigate:

- redundant tests that add no meaningful protection;
- assertions tied to incidental implementation details;
- tests that unnecessarily obstruct behavior-preserving changes;
- excessive or unrealistic mocking, including stale dependency assumptions;
- flaky, timing-dependent, or test-order-dependent behavior;
- unnecessary setup or duplicated fixtures that create maintenance cost;
- obsolete expectations for behavior no longer supported;
- assertions that do not establish the claimed outcome;
- broad tests whose failures are difficult to diagnose;
- important normal, boundary, failure, or lifecycle behavior lacking useful tests.

Distinguish suspected flakiness from observed instability. Report the evidence and conditions rather than labeling a test flaky from inspection alone.

Judge behavior at the relevant boundary. Outputs, state transitions, errors, and required side effects can all be meaningful contracts. Interaction counts or ordering may be valid assertions when they protect such a contract. Changes to test setup alone do not prove that a test is brittle.

Before recommending removal or consolidation, compare input ranges, failure modes, test levels, dependency fidelity, and diagnostic value. Tests covering the same feature or lines may protect different failures.

Identify what protection would be lost and demonstrate that it remains adequately covered or is no longer required. Do not delete a test merely because it appears redundant, runs slowly, or blocks a proposed refactoring.

Add or strengthen tests only to close a concrete protection gap. Where useful, use focused fault injection or mutation checks to investigate weak assertions; do not require them for every change or turn test counts and coverage percentages into targets.

### 6. Report findings and alternatives

For each significant, substantiated finding, report:

- file, symbol, and precise supporting references;
- relevant callers, dependencies, and current responsibility;
- concrete problem, evidence, and practical consequence;
- established facts, inferences with their verification result and evidence, and anything left unverified;
- proposed change and expected benefit;
- why the proposal is preferable to retaining the design or making a smaller change;
- behavioral risk and affected contracts;
- existing test protection and any specific additional verification needed;
- recommended priority and its rationale.

Use concise notes for related occurrences. Keep unconfirmed candidates separate from substantiated findings, with the next useful investigation identified. Do not force every candidate into a full finding template.

It is acceptable to state that existing tests are sufficient or no additional test is justified. Do not invent test work merely to fill a report field.

Include a brief scope summary, material limitations, and relevant investigation results even when no significant findings are established. Do not describe unexamined areas as verified.

### 7. Prioritize by benefit, cost, and confidence

Favor problems that create correctness risk, obscure important behavior, duplicate business rules, spread changes across unrelated code, make failures difficult to diagnose, undermine test reliability, or expose accidental implementation details to multiple consumers.

Also consider:

- frequency and importance of the affected behavior or maintenance task;
- strength of the evidence and uncertainty about the diagnosis;
- expected improvement from the proposed change;
- implementation and verification effort;
- regression risk and reversibility.

Keep impact and confidence distinct. A potentially severe issue whose supporting inference is still unverified requires that verification before implementation.

Do not prioritize cosmetic cleanup over consequential structural problems. Do not assume that the widest-reaching or most complex-looking issue is automatically the best next change. Deferral or no change is appropriate when expected benefit does not justify cost and risk.

### 8. Establish a baseline and refactor incrementally

When implementation is within the authorized scope:

1. Identify the contracts to preserve. Distinguish current behavior from documented requirements and confirmed expectations. Surface conflicts rather than silently deciding that the current implementation is correct.
2. Before editing, run relevant existing tests and checks where available. Record pre-existing failures, unstable results, and checks that cannot run. Do not attribute them to the refactoring without evidence.
3. Add or improve behavioral tests only where necessary to protect the planned change. Characterization tests may record current behavior, but do not treat that behavior as an approved requirement or silently encode a known bug as correct.
4. Make the smallest coherent structural change. Preserve unrelated work and avoid incidental cleanup.
5. Run the relevant tests and static checks, compare with the baseline, and inspect the diff for unintended changes. Expand verification only when the affected scope, remaining risk, or repository requirements justify it.
6. Confirm that the intended structural benefit was achieved and check the affected contracts using appropriate evidence. Depending on the change, these may include API behavior, errors, state transitions, persistence formats, side effects, ordering, cancellation, or consequential resource behavior.
7. Proceed incrementally, keeping each change understandable and reversible where practical. Reassess the plan if new evidence changes the diagnosis or risk.

Do not combine unrelated cleanup, feature changes, bug fixes, and structural refactoring. If a coupled change is necessary, explicitly identify the behavioral change, its justification, and its verification; do not describe the combined change as purely behavior-preserving.

Passing tests support a bounded claim about the behavior checked. They do not prove equivalence for every input or environment. Report the evidence obtained and any material unverified conditions. Do not weaken valid assertions merely to obtain a passing result.

### 9. Finish at a defensible boundary

Complete the audit when the agreed scope has been surveyed, selected critical flows and high-priority suspicions have been investigated sufficiently for actionable conclusions, and unresolved questions and unexamined areas have been recorded.

Do not stop solely because a target number of findings has been reached. Do not continue searching indefinitely for more issues when further investigation is unlikely to change the recommendations materially. If material scope remains incomplete because of access, time, or execution limits, describe the result as partial and identify the remaining work.

For implementation, finish when the authorized changes achieve their stated purpose, relevant verification is complete to the justified extent, and remaining risks or blockers are reported. Do not expand into unrelated refactoring simply because additional improvements are possible.

The final report should make clear what was examined, what was established, what changed if applicable, what checks actually ran and their outcomes, and what remains uncertain or deferred.

### 10. Avoid arbitrary cleanliness targets

Do not:

- split functions merely to reduce line count;
- add abstractions merely to eliminate small amounts of duplication;
- introduce interfaces or layers based only on imagined future flexibility;
- replace understandable code with elaborate design patterns;
- optimize for file count, class count, test count, coverage percentage, abstraction depth, deleted lines, or number of findings.

An interface can be justified even with one implementation when it provides a concrete benefit, such as a clearer consumer contract, controlled dependency direction, or isolation of an external boundary. Evaluate that benefit against the added complexity.

Prefer the simplest structure that makes behavior, ownership, dependencies, and change boundaries clear. Measure success by substantiated problems resolved, useful test protection preserved, and a demonstrable reduction in the difficulty or risk of relevant future changes.