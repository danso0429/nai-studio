# 🤖 Agent Usage Instructions (for Claude sessions in this repo)

When you (Claude, the primary session) consider delegating work to subagents
(`Agent` tool / Explore / Plan / general-purpose), follow these rules. They
exist because past agent usage in this repo produced **~75% stale results
on the P15 catalog** (메모리 [[feedback_catalog_readthrough_hallucination]])
and missed file locations entirely (memory [[feedback_search_paths_before_asking]]).

This document is the agent counterpart of `runtime-audit-instructions.md`.

────────────────────────
# 0. Pre-spawn Protocol (run BEFORE invoking any Agent tool)

Spawning without these checks is the #1 cause of garbage agent output.

- [ ] **Do you already know the answer?** If you've read the file, just answer
      directly. Spawning an agent to "double-check" a known fact is pure
      latency + hallucination surface. Reserve agents for things you genuinely
      can't answer in your current context.
- [ ] **Can you define the agent's output as a strict schema?** If you can't
      describe the expected output shape in <5 lines (fields, allowed values,
      max length), the task is too open-ended. Either narrow it or do it
      yourself.
- [ ] **Can you spot-check the result in <30 seconds?** A claim like "this
      symbol has 0 callers" is spot-checkable (re-run grep). A claim like
      "the code is clean" is not. Don't accept un-checkable answers.
- [ ] **Are you assigning the right subagent_type?** Use Explore for read-only
      lookup, Plan for design analysis, general-purpose only when neither
      fits. NEVER hand `Edit`/`Write`/`Bash` (write side) to an agent for a
      fix task — fix bugs subtly and silently. Agents apply fixes only when
      you've explicitly verified the change set is mechanical (rename, single
      pattern replacement) and the user OK'd it.
- [ ] **Did you read enough context to write a self-contained prompt?** The
      agent has zero context from this conversation. The prompt must include
      file paths, line numbers, exact claim text, expected output schema.
      Terse prompts produce shallow output (per Claude Code prompt guide).

If any checkbox unticked: do the task yourself OR narrow the task until all
five tick.

────────────────────────
# 1. When to Use Agents (and when NOT)

**Use agents when**:
- N independent lookups that can run in parallel (e.g. verify 10 audit
  claims, grep 5 different symbols across the repo)
- Bounded read-only research where the answer fits a strict schema
- Architecture inference for a subsystem you haven't touched (Plan agent)
- One-shot greps with hard-to-write regex (general-purpose with explicit
  command in prompt)

**Do NOT use agents for**:
- Open-ended "review this code" / "find bugs" / "is this safe" — agents
  generate plausible-sounding critique with low precision. Do this yourself
  or use a dedicated tool (e.g. `code-reviewer` agent if available).
- Fix application (Edit/Write) — even seemingly mechanical changes hide
  edge cases. Apply fixes yourself; let agent only verify/locate.
- Anything where you don't know the expected answer shape — you can't
  spot-check what you can't describe.
- Questions you can answer directly with Read/Grep in <2 tool calls.

**Hard NO**:
- Multiple agents on overlapping scope (waste + inconsistent results).
- Recursive agent spawning (agent that spawns agents) without explicit user
  OK — context degrades exponentially.

────────────────────────
# 2. Output Schema Templates

When you spawn an agent, the prompt MUST specify output schema. Common
templates below — copy-paste and adapt.

## 2.1 Single claim verify (audit / catalog / refactor proposal)

```
Verify this claim against the current codebase.

Claim: <verbatim claim text>
Location asserted: <file>:<line>

Output schema (exactly this format, no prose preamble):

CLAIM_QUOTE: <3-5 lines of verbatim code from file:line — copy from Read tool>
CLAIM_MATCHES_REALITY: YES | NO | PARTIAL
CALLERS_COUNT: <integer — run `grep -rn <symbol> <scope>` and count>
CALLERS_LIST: <up to 5 file:line — or "many — not enumerated">
EFFORT: Quick win | Localized | Cross-cutting | Refactor project
NOTES: <max 30 words on why / caveats>

If the file or line cannot be found, output FILE_NOT_FOUND. Do NOT invent.
```

Spot-check protocol after agent returns:
- Re-Read the asserted file:line. Confirm `CLAIM_QUOTE` matches verbatim
  (whitespace OK to differ, content not).
- Re-run the grep yourself for `CALLERS_COUNT`.
- If either mismatches: discard agent output entirely + investigate why.

## 2.2 Live-vs-dead symbol check (batch)

```
For each symbol below, count callers in scope <scope-paths>.

Symbols:
- <Symbol1>
- <Symbol2>
- ...

Output schema (one line per symbol):

<Symbol>: <int> callers <- top 3 file:line>

If 0 callers: append "DEAD". Do not provide commentary.
```

Spot-check: pick 2 random symbols, re-grep, confirm count matches.

## 2.3 Section 0 Architecture Pass (per subsystem)

```
Apply runtime-audit-instructions.md Section 0 to <subsystem>.

Files in scope: <paths>

Output schema (5-15 bullet points total, no prose preamble):

CONCURRENCY_FENCES:
- <fence>: <how it bounds concurrency>
- ...

BOUNDARY_CALLS:
- <call site file:line>: <cheap ACK | heavy work>
- ...

SUBMIT_VS_AWAIT:
- <pattern>: <observation>

LIVE_OR_DEAD:
- <symbol>: <N callers | DEAD>

BOUNDED_PRIMITIVES:
- <helper>: <guarantee>

If a category has 0 entries, omit it. Do not pad.
```

Spot-check: pick 1 fence + 1 dead-symbol claim, re-verify.

## 2.4 File location lookup (when path unknown)

```
Find files matching: <criteria — e.g. "implements interface X" / "imports module Y" / "named NaiClient">

Scope: <paths>

Output schema (one line per match, max 10):

<absolute path>: <reason — 1 line>

If 0 matches: output NO_MATCHES. Do NOT propose alternatives unprompted.
```

Spot-check: `ls`/`find` the top 2 paths to confirm existence.

────────────────────────
# 3. Anti-hallucination Guard

Agents fabricate confidently. Watch for these failure modes:

- **Fabricated line numbers**: agent quotes `server.js:1234` but actual file
  is 800 lines. → Always re-Read the asserted location.
- **Plausible-but-wrong symbol counts**: agent says "5 callers" when actual
  is 0 or 50. → Always re-grep.
- **Hallucinated APIs**: agent references methods/types that don't exist in
  the current codebase. → If a claim depends on `foo.bar()`, grep for `\.bar(`
  to confirm.
- **Synthesized "verbatim" quotes**: agent paraphrases code as if quoted. →
  Verbatim means byte-identical (modulo whitespace). Compare char-by-char on
  suspicious quotes.
- **Confident defer recommendations**: agent says "this is fine, no action
  needed" without verifying. → If output schema includes EFFORT/DEFER, treat
  it as a hypothesis, not a conclusion.
- **Drift on multi-claim batches**: in a 10-claim verify, early claims are
  often accurate, later ones drift toward generic. → Spot-check the LAST
  claim, not the first.

If three or more spot-checks fail in one agent batch: discard the whole
batch and either redo manually or narrow the scope and retry.

────────────────────────
# 4. Tool Permission Matrix

| Subagent type    | Read | Grep/Glob | Bash (read-only) | Bash (write) | Edit/Write |
|------------------|------|-----------|------------------|--------------|------------|
| Explore          | ✓    | ✓         | ✓                | ✗            | ✗          |
| Plan             | ✓    | ✓         | ✓                | ✗            | ✗          |
| general-purpose  | ✓    | ✓         | ✓ default        | only if asked| ✗ default  |
| claude (catch-all)| ✓   | ✓         | ✓                | only if asked| only if asked |

Rules:
- For audit/verify/lookup tasks: **always** prefer Explore. It can't break
  anything.
- Plan agent: for "how should I approach X" only. NOT for fix application.
- general-purpose: when scope spans tool categories AND prior types don't
  fit. Tighten the prompt extra carefully — broader tool access = wider
  hallucination surface.
- claude (catch-all): default in FleetView when no name typed; in this repo
  prefer Explore unless agent must apply changes. If you do give Edit/Write,
  state the exact files + change pattern in the prompt + require the agent
  to output `git diff` of its changes for review BEFORE accepting.

NEVER:
- Hand Edit/Write to general-purpose for "find and fix all X" — that's
  exactly the case where mechanical-looking changes break things subtly.
- Skip the "output the diff" requirement when an agent applies any change.

────────────────────────
# 5. Result Processing Protocol (S1–S5)

After an agent returns, follow these steps in order. Skipping S1 is the #1
cause of drift — the rules slip out of working memory by the time the agent
reply arrives (often many minutes after spawn, deep into the conversation).

## S1 — Instructions re-read (MANDATORY, every time)

Re-read this document + the relevant memories before touching agent output:
- [[feedback_catalog_readthrough_hallucination]] — 5 hallucination guard rules.
- [[feedback_agent_usage_safety]] — pre-spawn + spot-check + fix-application rules.
- [[feedback_no_guess_from_partial_output]] — small output exhaustive check.

Why mandatory and not "you already read it once this session": agent reply
arrives long after spawn. The Section 3 anti-hallucination patterns and
Section 4 permission rules need to be loaded fresh — not recalled from a
faded earlier turn. The cost is ~30s; the cost of skipping is accepting a
stale claim into the report.

## S2 — Schema compliance check (first gate)

- Read agent output file/message.
- If schema mismatch (missing required fields, wrong field format, extra
  prose preamble, freeform paragraphs where structured items expected):
  treat as hallucination signal → **DISCARD batch entirely**. Do NOT try
  to parse around it.
- Schema mismatch alone is sufficient to discard. The agent demonstrated
  inability to follow the most explicit instruction; per-finding accuracy
  is unlikely to be better.

## S3 — Spot-check (minimum 5 cases per batch)

- **First finding**: verbatim quote re-Read at asserted file:line.
- **Middle finding** (random): verbatim quote re-Read + grep count re-run.
- **Last finding**: verbatim quote re-Read at asserted location.
  (Section 3 "Drift on multi-claim batches" — later claims drift toward
  generic. Spot-check the LAST, not just the first.)
- **1+ DEAD claim**: re-grep to confirm 0 callers (or whatever DEAD
  predicate was asserted).
- **1+ "duplicate / already-tracked" claim**: re-verify it really IS a
  duplicate, not a misclassified new finding hidden under the duplicate
  label.

Tally rule: **3+ spot-check failures → DISCARD whole batch**, log root
cause in S5 journal note, then redo manually or with narrower scope. Do
not cherry-pick "the parts that looked OK" from a failed batch — drift
contaminates the whole output.

## S4 — Integration of passing batch

- Merge surviving findings into the relevant report (e.g.
  `docs/runtime-audit-report.md` for the runtime audit).
- Entries marked "Already-tracked ✓" by the agent: **SKIP** — don't
  double-record. (But verify the duplicate match in S3 first.)
- New findings: insert into the proper severity section + update the
  Executive summary count table.
- **Fixes are applied BY YOU, not by the agent.** Never trust an agent's
  claim that "I applied the fix" without re-running `git diff` and
  reading the change yourself.

## S5 — Closeout + journal note

- Recompute Top 5 / Quick wins if surviving findings shifted them.
- Identify next batch candidate (Q1 first per audit-instructions quadrant
  rule).
- JOURNAL note: agent batch stats — **N found / N passed S3 / N discarded
  / stale ratio / which categories the agent hallucinated most**. This is
  pattern data for future audit passes — over time you learn which
  subsystems / claim types this agent fleet handles well vs poorly.

────────────────────────
# 6. Common Anti-patterns Seen In This Repo

These have actually happened — listed to prevent recurrence.

- **P15 catalog hallucination (2026-05-17)**: agent classified ~149 catalog
  entries; ~75% turned out stale on verification. Cause: open-ended "audit
  this catalog" prompt. Lesson: per-entry strict schema.
- **external codebase path search (2026-05-17)**: agent reported "file not
  found" instead of running `find`. Cause: agent gave up early. Lesson: hand
  it the exact find command + require attempt evidence (memory
  [[feedback_search_paths_before_asking]]).
- **runtime-audit ~30% stale claims (P17, 2026-05-19)**: not agent-generated
  but same root cause — per-pattern detection without architectural
  premise verification. Lesson encoded in
  `runtime-audit-instructions.md` Section 0; same principle for agents.

────────────────────────
# 7. Quick Decision Cheat Sheet

When considering an agent:

1. Read what you have. Can you answer directly? → don't spawn.
2. Is the question N parallel lookups with strict schema? → spawn Explore.
3. Is it open-ended analysis? → narrow it first OR do yourself.
4. Will the agent need to write? → 99% don't spawn. If yes, require diff.
5. Is the answer un-spot-checkable? → don't spawn.

If you spawn, prompt template:
- 1 sentence: goal.
- 3-5 lines: input (file paths, claim text, scope).
- 5-15 lines: output schema (strict format, allowed values, length cap).
- 1 line: anti-hallucination rule ("If you can't find X, output X_NOT_FOUND.
  Do NOT invent.").

────────────────────────
# 8. Relationship to Other Instructions

- `runtime-audit-instructions.md` Section 0 (Architecture Pass) is the
  per-claim equivalent — verify premise before per-pattern detection. Same
  spirit applied to subsystem-level analysis.
- `CLAUDE.md` L1/L2/L2.5/L3/L4 gates apply regardless of whether agents
  were used. Agent output is just one input to L2.5 self-audit.
- Memory references: [[feedback_catalog_readthrough_hallucination]] for
  classification accuracy + [[feedback_search_paths_before_asking]] for
  file location + [[feedback_no_guess_from_partial_output]] for output
  validation.
