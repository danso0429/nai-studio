# Pull Request Authoring Format

Use this combined format when a change is intentionally submitted through a pull
request. A pull request is a review and integration boundary, not the default
meaning of “push.”

The target repository's current contribution policy and pull request template
remain authoritative. This guide combines RisuAI's repository-native checklist
and section structure with explicit problem, compatibility, validation, risk, and
rollback evidence. The supporting survey and comparison are recorded in
[`risuai-pull-request-format.md`](risuai-pull-request-format.md).

## When to Use a Pull Request

Open a pull request when at least one of these conditions applies:

- The repository or upstream contribution policy requires review before integration.
- The user explicitly requests a pull request.
- An independent review, approval, or CI gate is needed before merging.
- Parallel work or a high-risk change benefits from an isolated integration branch.

For repositories that normally use direct integration to `main`, keep that convention unless one of the conditions above applies. Repository visibility—public or private—does not determine whether a pull request is needed.

## Before Opening

Confirm all of the following:

1. The repository, remote, base branch, and head branch are correct.
2. The target repository's current contribution policy and PR template have been
   re-read; cached copies are not assumed current.
3. No existing issue or pull request already covers the same work.
4. The change uses supported APIs or extension points, and existing architecture
   cannot satisfy the need more safely or with less maintenance.
5. Commits contain only the intended scope and do not include unrelated user
   changes.
6. The affected model, provider, platform, data, and compatibility surfaces have
   been identified before broad support claims are made.
7. Validation evidence is observed, current, and appropriate for the risk.
8. The diff contains no secrets, personal identifiers, private URLs, or user data.

## Title

Prefer:

```text
type(scope): imperative summary
```

Examples:

```text
fix(storage): preserve chats when a save is retried
feat(patcher): add provider output hardening
docs(contributing): clarify pull request validation
```

Use the target repository’s established title convention when it differs. Keep the title specific enough to distinguish the behavioral outcome, not merely the files changed.

## Combined Body Template

This template uses RisuAI's current top-level structure. Immediately before opening
a RisuAI PR, refresh the `PR Checklist` block from upstream and preserve any
repository changes verbatim. For another repository, retain its required
checklist and headings while mapping the same evidence into their closest
equivalents.

Do not check an item without evidence. Explain `N/A` when an unchecked required
item would be ambiguous. For conditional model or AI-generated branches, preserve
the repository's applicability semantics instead of treating an unchecked box as
a failed test.

```markdown
## PR Checklist

- Required Checks
    - [ ] Have you added type definitions?
    - [ ] Have you tested your changes?
    - [ ] Have you checked that it won't break any existing features?
- [ ] If your PR uses models[^1], check the following:
    - [ ] Have you checked if it works normally in all models?
    - [ ] Have you checked if it works normally in all web, local, and node-hosted versions? If it doesn't, have you blocked it in those versions?
- [ ] If your PR is highly AI generated[^2], check the following:
    - [ ] Have you understood what the code does?
    - [ ] Have you cleaned up any unnecessary or redundant code?
    - [ ] Is it not a huge change?
       - We currently do not accept highly AI generated PRs that are large changes.


[^1]: Modifies the behavior of prompting, requesting, or handling responses from AI models.
[^2]: Over 80% of the code is AI generated.

## Summary

<!-- Lead with the user-visible or operational outcome. -->
<!-- Describe the observed problem, why it matters, and the root cause when known. -->

-

## Related Issues

<!-- Use "Fixes #123", "Related: #123", and links to overlapping PRs as appropriate. -->
<!-- Explain how this scope differs from overlapping work. Write "None" if there is no related item. -->

## Changes

<!-- Explain behavior and design rather than narrating the file list. -->

- Behavioral changes:
- Design and important invariants:
- Alternatives considered:
- Non-goals:

## Impact

<!-- Remove lines that truly do not apply; do not fill them with boilerplate. -->

- Affected:
- Preserved:
- Web, local, and node-hosted compatibility:
- Tested model/provider matrix:
- Data, schema, migration, backup, and sync behavior:
- Performance or storage bounds:
- Security, privacy, official API, policy, or terms-of-service implications:
- Risks, limitations, and failure behavior:

## Additional Notes

### Validation

#### Automated

<!-- List exact commands/checks and their observed results. -->

-

#### Manual

<!-- List the environment and concrete interaction or API scenarios actually exercised. -->

-

#### Not tested

<!-- Disclose relevant untested paths and why. Do not present planned work as completed. -->

-

### UI Evidence

<!-- Optional for visible UI changes. Add before/after images, video, or a concise linked artifact. -->

### Review Focus / Open Questions

<!-- Required for drafts and useful for cross-cutting changes. Direct reviewers to uncertain or high-risk areas. -->

-

### Rollback and Follow-ups

- Rollback:
- Follow-ups:
```

For a small PR, keep the upstream checklist and applicable core headings, shorten
the prose, and remove irrelevant optional subheadings. Completeness means covering
the actual review risks, not maximizing body length or `N/A` count.

## Why This Combination

- RisuAI's checklist stays at the top because types, tests, regression risk,
  model/platform coverage, and AI-generated scope are repository-specific gates.
- `Related Issues` remains separate because duplicate and overlapping work is
  easier to review when it is not buried in motivation prose.
- Problem and root-cause evidence moves into `Summary`; a second top-level
  `Problem / Motivation` heading would duplicate the RisuAI structure.
- Compatibility and preserved behavior stay explicit inside `Impact`.
- Automated, manual, and untested evidence remains separated under
  `Additional Notes`; a single free-form test sentence is not equivalent.
- Risks remain in `Impact`, while rollback and follow-ups remain in
  `Additional Notes`.
- The old `Author Checklist` is not copied into the PR body because it duplicated
  both the upstream checklist and the final publish checks below.

## Writing Rules

- Write the title and body in English.
- Lead with the outcome and explain behavior before implementation detail.
- Separate observed facts from inferences and open questions.
- Separate completed validation from planned validation.
- Report exact validation commands, environments, counts, and results when they
  are meaningful.
- Do not translate a checklist phrase such as “all models” into a broad support
  claim unless that matrix was actually verified. Name the tested and untested
  matrix and any explicit platform block instead.
- Describe preserved behavior as well as the changed path.
- Omit an irrelevant optional subsection instead of filling it with boilerplate;
  preserve target-repository headings and checklist items as its policy requires.
- Keep long logs and demonstrations behind links or collapsible `<details>` blocks.
- Avoid a file-by-file diff narration unless the mapping helps reviewers understand the design.

## Draft Versus Ready for Review

Use a draft pull request when validation is incomplete, a design decision remains open, or the change is intentionally seeking early feedback. State the missing gate under **Review Focus / Open Questions**.

Mark the pull request ready only after:

- Applicable repository checklist items are supported by evidence or an explicit
  limitation.
- Required automated checks have completed with observed results.
- Required manual validation has completed, or its absence is explicitly accepted.
- Known risks and untested paths are disclosed.
- The branch is current enough with the base branch for the review to be meaningful.

## Final Publish Check

Immediately before publishing or updating the pull request:

1. Reconfirm the repository, remote, base branch, head branch, and current target
   template.
2. Re-read the rendered title and body as a reviewer.
3. Confirm links, issue references, screenshots, commands, and result counts are
   accurate.
4. Compare the PR commit range with the intended scope and search again for
   duplicate issues or PRs.
5. Confirm affected and preserved paths, types, tests, documentation, translations,
   compatibility, migration, and rollback are covered where applicable.
6. Confirm planned checks are not presented as completed and relevant untested
   paths are disclosed.
7. Check security, privacy, policy, official API, terms-of-service, and
   AI-assisted-code implications where relevant.
8. Re-run the repository’s sensitive-information sweep.
9. Select draft or ready status from the actual validation state.
