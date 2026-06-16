# 🤖 AI Agent Runtime Audit Prompt (JavaScript / TypeScript)

Perform a static audit and generate a report for the following JavaScript or TypeScript source code from the perspectives of Memory Management, Runtime Stability, Async Safety, CPU Usage, and Resource Lifecycle.

Prioritize detecting real runtime risks (OOM, Memory Leaks, Freezes, Race Conditions, Crashes, Event Loop Blocking) over style-related issues (ESLint, Prettier, formatting).

Use static analysis only; do not assume execution results. If uncertain, explicitly label conclusions as estimated or speculative.

Infer the likely execution environment whenever possible:
- Browser
- Node.js
- Deno
- Bun
- Web Worker
- Framework runtime
- Serverless runtime

Apply environment-specific audit criteria accordingly.

────────────────────────
# 0. Architecture & Boundary Inference (run BEFORE per-pattern detection)

Before applying patterns 1–11, identify and document the audited code's
architectural fences. This step is what prevents per-pattern detection from
producing claims whose premise is already false in this codebase.

Identify:
- **Concurrency fences**: Where does the code serialize requests?
  (server-side queues, single-flight gates, serial `while` loops, async
  chains, semaphores, mutex helpers, rate-limit middleware)
- **Boundary calls**: Which calls cross network / disk / IPC? For each,
  classify the actual cost:
  - **Cheap ACK** (submit-and-return, server-side queue, fire-and-forget)
  - **Heavy work** (synchronous external API, large file I/O, long CPU)
- **Submit-vs-await pattern**: Does API `X` synchronously wait for work to
  complete, or submit it to a background worker and return immediately?
  (This single distinction often invalidates "stacking" / "fan-out" claims.)
- **Live-vs-dead paths**: Which exported symbols / handlers have zero callers
  in the audited scope? Mark them DEAD and skip per-pattern analysis on them.
- **Bounded concurrency primitives**: Existing chunked-map helpers, retry
  caps, queue size limits, in-flight singletons — note their guarantees.

Output this as a 5–15 line "Architecture Summary" at the top of the audit
report (one bullet per fence/boundary). Subsequent per-pattern claims MUST
reference this summary when asserting concurrency, stacking, fan-out, or
unbounded growth. A claim that contradicts the architecture summary must
either drop confidence to **Low** or be discarded.

Example fences worth calling out explicitly:
- "`backend.generateImage` is submit-and-return (POST `/queue/add`) — heavy
  NAI work happens on server. Client-side 'stacking' claims must count
  concurrent POST attempts, not concurrent NAI generations."
- "Image fetch path uses an `acquireMutex(path)` FIFO chain — same-path
  concurrent calls are serialized at the mutex layer."
- "`processQueue` is a single `while` loop with `if (queueProcessing) return`
  guard — exactly one job in flight at a time."

────────────────────────
# 1. Memory Pressure / Heap Overflow Risk (OOM)

Detect:
- Large array/object allocations
- Repeated spread operations
- Excessive Object.assign usage
- Deep cloning
- Repeated JSON.parse / JSON.stringify
- Unbounded cache growth
- Long-lived Map / Set
- Large payload retention
- Structures preventing memory release

Evaluate:
- Heap growth likelihood
- Long-running OOM risk
- Peak memory pressure potential

Recommend:
- Streaming
- Pagination
- Chunk processing
- WeakMap / WeakSet
- Lazy evaluation

────────────────────────
# 2. Memory Leak & Retained Reference Risk

Detect unreleased resources:
- setInterval
- setTimeout
- EventEmitter
- WebSocket
- Observer
- Subscription
- Missing AbortController cleanup
- Promise retention
- Closure retention
- Singleton caches
- Global accumulation

Note:
Prioritize objects retained by GC roots, not circular references alone.

────────────────────────
# 3. CPU Hotspot / Main Thread Blocking

Detect:
- Nested loops
- O(n²)+ algorithms
- Repeated sort/filter/reduce
- Synchronous crypto
- Synchronous compression
- Heavy regex
- Large JSON processing
- Repeated serialization

Estimate complexity:
- O(1)
- O(log n)
- O(n)
- O(n²)
- O(n³)+

Recommend:
- Memoization
- Workers
- Incremental processing

────────────────────────
# 4. Async Safety & Race Conditions

Detect:
- Missing await
- Unhandled Promises
- Parallel request conflicts
- Stale response overwrites
- Retry storms
- Race conditions
- Duplicate requests
- Infinite recursion
- Polling leaks

Evaluate impact:
- Data corruption
- State inconsistency
- Unpredictable behavior

────────────────────────
# 5. Error Handling Robustness

Detect missing:
- try/catch
- .catch()
- finally
- Timeout handling
- Abort handling
- Fallback logic

Evaluate:
- Crash potential
- Silent failure risk
- Resource leak risk

────────────────────────
# 6. Event Loop Starvation / Freeze Risk

Detect:
- Heavy loops
- Sync I/O
- Sync parsing
- CPU-intensive tasks

Impact:
- UI freezes
- Delayed timers
- Reduced responsiveness

Recommend:
- queueMicrotask
- requestIdleCallback
- Worker threads
- Chunk processing

────────────────────────
# 7. Large String / Binary Handling

Detect:
- Base64-heavy workflows
- Repeated string concatenation
- Large template literals
- Buffer duplication
- Large stringify operations

Recommend:
- Streams
- Blob
- ArrayBuffer
- Chunk processing

────────────────────────
# 8. Resource Lifecycle Problems

Detect unreleased:
- File handles
- DB connections
- Sockets
- Streams
- Child processes
- Locks

Evaluate:
Long-running accumulation risk

────────────────────────
# 9. Infinite Growth Risk

Detect:
- Cache
- Queue
- Retry lists
- Metrics accumulation
- Logs
- In-memory state

Evaluate:
Long-term stability degradation risk

────────────────────────
# 10. Environment-Specific Runtime Risks

Browser:
- Detached DOM nodes
- Event listener leaks
- Animation loops
- MutationObserver leaks
- ResizeObserver leaks

Node.js:
- EventEmitter leaks
- Open handles
- Unresolved Promises
- Worker leaks

Serverless:
- Cold start amplification
- Global cache contamination
- Memory reuse issues

────────────────────────
# 11. Security-Relevant Runtime Risks

Detect:
- eval()
- Function()
- Prototype pollution risks
- Regex DoS
- Unbounded input handling
- Arbitrary code execution risks

────────────────────────
# Required Output Format

Severity:
(Critical / High / Medium / Low)

Location:
(file / function / line)

Category:

Issue:

Technical Cause:

Potential Runtime Impact:

Estimated Frequency:
(Always / Under Load / Rare)

Confidence:
(High / Medium / Low)

Verification (REQUIRED — leave checkbox unticked if not done; unticked items
force Confidence down):
- [ ] Quoted the exact code line that creates the risk (verbatim, with
      file:line — not paraphrased)
- [ ] Counted call sites of the function/symbol (N callers — list them, or
      mark "0 callers — DEAD" / "many — not enumerated")
- [ ] Traced one full call graph from entry (HTTP route / WS event / UI
      handler) to the leaf where the pattern fires
- [ ] Confirmed the pattern is not fenced by a known concurrency boundary
      from the Architecture Summary (Section 0)
- [ ] For any claim asserting "concurrent" / "stacking" / "fan-out" /
      "unbounded growth": counted the concrete invocation paths and ruled
      out architectural fences

Confidence calibration:
- **High**: all five checkboxes ticked.
- **Medium**: 3–4 ticked; one missing dimension is non-load-bearing.
- **Low**: ≤ 2 ticked, OR the claim relies on a behavior pattern (stacking,
  retry storm, OOM) without enumeration of concrete paths. Low-confidence
  claims are reported but must not be ranked in the Top 5.

Recommended Fix:

Patch Example:

Estimated Improvement:

Change Surface (REQUIRED — drives Fix Effort classification):
- Files touched: <count + path list>
- Public interface changes: <none / function signature / type / new module>
- Caller count to update: <number; list if ≤ 5>
- Type-system caught: <Yes/No — would TS error catch incomplete migration?>
- Manual test surface: <single endpoint / module / cross-feature flow>

Fix Effort:
(Quick win / Localized / Cross-cutting / Refactor project)

Definitions:
- **Quick win**: 1 file / encapsulated function / type system catches
  incomplete migration. <30 lines diff likely.
- **Localized**: 2–3 files in adjacent modules; signature unchanged or
  one optional parameter added.
- **Cross-cutting**: 4+ files OR public interface signature change OR
  changes propagate across handler/backend/caller layers.
- **Refactor project**: One subsystem rebuilt (e.g., collapse N maps into
  one; change synchronization primitive). Single PR, dedicated test pass.

Severity × Effort Quadrant:
(Q1 Quick win / Q2 High value / Q3 Polish / Q4 Defer)

| Severity        | Effort                | Quadrant                         |
|-----------------|-----------------------|----------------------------------|
| Critical / High | Quick win / Localized | Q1 — fix in current batch        |
| Critical / High | Cross-cutting         | Q2 — standalone commit + L3      |
| Critical / High | Refactor project      | Q2 — dedicated phase, user OK    |
| Medium / Low    | Quick win             | Q3 — fold into nearby commit OK  |
| Medium / Low    | Localized+            | Q4 — defer with rationale        |

The Top 5 ranking (in Final Summary) must use Quadrant first, then Severity.
A Q1 Medium ranks above a Q4 Critical — the latter is a separate project.

### No-waiver rule (Severity/Frequency never justifies dropping a finding)

A low Severity or "Rare" Frequency NEVER justifies silently dropping a finding
or labeling it "fix unnecessary" — there is no such category. Every reported
finding lands in exactly one Quadrant:
- Q1/Q2 → fix now / dedicated.
- Q3 (Low/Medium + Quick win) → fold into a nearby commit and FIX it. "Rare"
  lowers priority, not the obligation to fix a solvable Quick win.
- Q4 (Low/Medium + Localized+) → defer ONLY with an explicit written rationale
  stating why the fix cost outweighs the benefit *now* (concrete effort vs.
  benefit). "Rare/Low, so skip" is NOT a rationale.
If a fix carries a trade-off, state the trade-off and let the user decide — do
not unilaterally waive it.

────────────────────────
# Final Summary (Required)

1. Architecture Summary recap (1–2 lines — the fences that bounded this audit)
2. Number of critical issues (Critical/High by Severity, and Q1/Q2 by Quadrant)
3. Memory leak risk score (0–10)
4. CPU bottleneck risk score (0–10)
5. Long-term runtime stability score (0–10)
6. Estimated production failure likelihood (0–10)
7. Top 5 highest-priority fixes (ranked by Quadrant first, Severity second —
   Q1 items always rank above Q2 regardless of Severity, since Q2 needs
   dedicated project)
8. Deferred items (Q4): list with rationale — keep in report but explicitly
   not actionable in casual batches

────────────────────────
# Important Rules

Do NOT report the following unless they directly affect runtime behavior:
- Semicolon usage
- Prettier formatting
- ESLint style rules
- Naming preferences
- Import ordering
- Formatting-only concerns

Prioritize production runtime risks over style opinions.

────────────────────────
# Anti-hallucination Guard

Pattern-match findings are cheap; verified findings are rare. A claim that
matches the surface pattern but contradicts this codebase's actual call
graph wastes review time and erodes trust in the report.

Concrete failure modes to watch for, with fixes:

- **"Stacking" claims without serial-loop check**: If the call graph from
  entry to the suspect line goes through a `while (next)` loop, `await
  acquireMutex(...)`, or `if (running) return` guard, the in-flight count
  is bounded by that primitive — not by retry count. Either count concrete
  concurrent paths or drop confidence.
- **"Fan-out" claims without thread-pool / chunked-map check**: Promise.all
  across N items only fans out N tasks IF there's no upstream chunking and
  the items represent real concurrent boundary calls. A 16-chunked-map
  helper already present in the audited file invalidates the claim.
- **"Submit-and-await" assumption when boundary is fire-and-forget**: If
  the call is `POST /queue/add` to a server-side queue and returns on ACK,
  the client never holds the heavy payload past upload completion. Claims
  that the client retains the heavy payload "across stale flights" must
  count concurrent uploads, not concurrent server-side jobs.
- **"Unbounded growth" claims without retention-cap check**: If the audited
  structure has an explicit `if (length > MAX)` truncation or LRU cap, the
  claim must address how that cap is bypassed. Otherwise drop confidence.
- **Stale specifics**: function names / line numbers / API signatures
  drift between revisions. Always quote the line verbatim from the current
  file. If your quote doesn't match the current code, your claim is stale.
- **Over-estimation (inflated impact)**: claims like "up to N concurrent / N
  stacked" MUST be reconciled against the Architecture Summary fences (suspend
  behavior, single-tab/session, job caps) — report the ACTUAL count after
  fences, not the theoretical max. An impact inflated past its fence is as wrong
  as a missed finding.
- **Under-estimation (dismissed impact)**: never downgrade Severity/Frequency to
  dodge the fix obligation. "Rare" is a Frequency label, not a waiver. If real
  impact is small, say so with the bounding fence — it still gets a Quadrant.
- **Lazy search**: before declaring "0 findings" for a category, list the exact
  file:line ranges read for it. A category marked clean without a read-path list
  is unverified, not clean.

Every impact estimate (frequency, concurrency, growth) is a claim — re-verify by
re-reading the relevant code + fences, not by intuition.

If in doubt, mark Confidence: Low and explain what you couldn't verify. A
Low-confidence claim is useful as a follow-up pointer; a confidently-wrong
claim is a tax on every future audit pass.
