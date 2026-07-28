# RisuAI Pull Request Survey and Format Comparison

This document records the Original RisuAI survey and comparison that informed the
combined authoring format in
[`pull-request-format.md`](pull-request-format.md). The live template exists only
in that authoring guide so the two documents cannot drift into competing formats.

## Survey Scope

Snapshot date: **2026-07-28 KST**.

Template sources:

- [Live RisuAI pull request template](https://github.com/kwaroran/Risuai/blob/main/.github/pull_request_template.md)
- [Template snapshot at `846c897`](https://github.com/kwaroran/Risuai/blob/846c897bf56e3e0121ef12e7ba07f5c3912dfa78/.github/pull_request_template.md)

The survey covered all 1,229 pull requests returned by GitHub's pull request API,
from PR #1 through PR #1563. Numbers in that range that are absent from the pull
request dataset are issues or other non-PR numbers, not missing survey pages.

| Population | Count |
| --- | ---: |
| All pull requests | 1,229 |
| Merged | 990 |
| Open | 83 |
| Closed without merge | 156 |
| Non-empty bodies | 1,125 |

## Format History

| Created | PRs | Dominant body evidence |
| --- | ---: | --- |
| 2023 | 170 | 51 used both the early checklist and `Description`; many early bodies were free-form or empty. |
| 2024 | 336 | 324 used the checklist and `Description`, making the old format dominant. |
| 2025 | 370 | 354 used the checklist and 348 used `Description`; richer custom subsections appeared inside it. |
| 2026 | 353 | 329 used `PR Checklist`, 298 `Summary`, 261 `Related Issues`, 287 `Changes`, 264 `Impact`, and 203 `Additional Notes`. |

The first body in the dataset containing all six current top-level sections is
[PR #1211](https://github.com/kwaroran/Risuai/pull/1211), created on
2026-01-15. This is an observed transition point in PR bodies, not proof of the
exact template-file commit that introduced the change. The preceding
[PR #1209](https://github.com/kwaroran/Risuai/pull/1209) still uses the old
`PR Checklist` plus `Description` shape.

The latest 100 PRs at the snapshot (#1452 through #1563 in API order) show the
current convention more clearly:

- 96 include `PR Checklist`.
- 99 include `Summary`, 87 `Related Issues`, 90 `Changes`, 87 `Impact`, and
  82 `Additional Notes`.
- 79 retain all six current top-level sections. Missing sections are often omitted
  as inapplicable rather than replaced with another standard.
- 95 use a conventional title prefix: `feat` 39, `fix` 37, `refactor` 6,
  `chore` 5, `perf` 4, `test` 2, `docs` 1, and `style` 1.

Section presence alone is not a quality or acceptance signal.
[PR #1526](https://github.com/kwaroran/Risuai/pull/1526) was merged with a short
body that omitted `Impact` and `Additional Notes`. Conversely,
[PR #1563](https://github.com/kwaroran/Risuai/pull/1563) is detailed and
template-aligned but was still open at the snapshot. It is an authoring example,
not evidence of maintainer approval.

## Evidence Found in Stronger PRs

Detailed PRs such as [PR #1563](https://github.com/kwaroran/Risuai/pull/1563)
and the merged [PR #1551](https://github.com/kwaroran/Risuai/pull/1551) add:

- a behavioral outcome rather than a file summary;
- issue and overlapping-PR relationships;
- current behavior, root cause, chosen design, invariants, alternatives, and
  deliberate non-goals;
- affected and preserved behavior, compatibility, migration, resource bounds, and
  known limitations;
- exact automated results, manual probes, untested scenarios, and follow-ups.

The RisuAI form also has weak signals that should not be mistaken for evidence:

- “won't break any existing features” is too absolute without named regression
  paths and results;
- “all models” is not a verified support claim unless the actual matrix was tested;
- an AI-generated percentage is a repository policy heuristic, not a correctness
  measurement;
- `Additional Notes` can become a catch-all that mixes completed tests, planned
  tests, limitations, and follow-ups.

PR #1563 illustrates both sides: it documents design alternatives, persistence
impact, limits, and automated results well, but its manual checks were still
written as future work at the snapshot.

## Pre-Combination Comparison

| Concern | Earlier repository-neutral guide | RisuAI-derived format |
| --- | --- | --- |
| Scope | Reusable across repositories | Original RisuAI pull requests |
| Checklist | Broad author checklist at the end | Checklist first: types, tests, regressions, model/platform coverage, and AI-generated scope |
| Core narrative | `Summary`, `Problem / Motivation`, `Changes` | `Summary`, `Related Issues`, `Changes` |
| Compatibility | Dedicated `Impact and Compatibility` | Folded into `Impact` |
| Validation | Dedicated automated, manual, and not-tested sections | Usually free-form under `Additional Notes` |
| Risk disclosure | Dedicated risks, limitations, and rollback section | Usually limitations in `Impact`; rollback is not required |
| Review aids | Optional UI evidence and review-focus sections | No dedicated official headings |
| Strongest property | Explicit evidence and omission resistance | Repository-native policy and reviewer familiarity |
| Main weakness | Can become heavy or repetitive for small PRs | Compact headings can hide missing evidence |

## Combined Decision

The combined guide deliberately uses:

- RisuAI's checklist position and official top-level headings;
- the earlier guide's explicit problem, preserved behavior, compatibility,
  automated/manual/not-tested evidence, risks, rollback, and review focus;
- one final publish check outside the PR body instead of a second visible author
  checklist;
- optional subsections that can be removed for small PRs without removing
  applicable repository-required headings.

The result is not a full copy of either earlier format. RisuAI provides the
repository-native envelope; the earlier guide supplies the evidence standard.
