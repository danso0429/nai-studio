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

Recommended Fix:

Patch Example:

Estimated Improvement:

────────────────────────
# Final Summary (Required)

1. Number of critical issues
2. Memory leak risk score (0–10)
3. CPU bottleneck risk score (0–10)
4. Long-term runtime stability score (0–10)
5. Estimated production failure likelihood (0–10)
6. Top 5 highest-priority fixes

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
