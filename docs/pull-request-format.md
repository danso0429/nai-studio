# Pull Request Authoring Format

Use this format when a change is intentionally submitted through a pull request. A pull request is a review and integration boundary, not the default meaning of “push.”

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
2. No existing issue or pull request already covers the same work.
3. The change follows the repository’s contribution policy and uses supported APIs or extension points.
4. Existing architecture cannot satisfy the need more safely or with less maintenance.
5. Commits contain only the intended scope and do not include unrelated user changes.
6. Validation evidence is observed, current, and appropriate for the risk.
7. The diff contains no secrets, personal identifiers, private URLs, or user data.

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

## Body Template

Copy the template below. Remove optional sections and instructional comments that do not apply.

```markdown
## Summary

<!-- In 1–3 bullets, state the user-visible or operational outcome. -->

-

## Problem / Motivation

<!-- Describe the observed problem, why it matters, and the root cause when known. -->
<!-- Link an issue with "Closes #123" or "Related: #123" when applicable. -->

## Changes

<!-- Explain the behavioral and design changes. Include non-goals when they prevent scope ambiguity. -->

-

## Impact and Compatibility

<!-- Name affected paths, data/config/schema changes, and normal paths that remain supported. -->

- Affected:
- Preserved:
- Migration or compatibility notes:

## Validation

### Automated

<!-- List exact commands/checks and their observed results. Do not predict results. -->

-

### Manual

<!-- List the environment and concrete interaction scenarios that were actually exercised. -->

-

### Not tested

<!-- Disclose relevant paths that were not tested and why. Remove only when coverage is explicit above. -->

-

## Risks, Limitations, and Rollback

<!-- State remaining risks, known limitations, failure behavior, and a safe rollback path. -->

- Risks and limitations:
- Rollback:

## UI Evidence

<!-- Optional for visible UI changes. Add before/after images, video, or a concise linked artifact. -->

## Review Focus / Open Questions

<!-- Required for drafts and useful for cross-cutting changes. Direct reviewers to uncertain or high-risk areas. -->

-

## Author Checklist

- [ ] I confirmed the correct repository, base branch, and head branch.
- [ ] I searched for duplicate issues and pull requests.
- [ ] I described affected paths and existing behavior that must remain supported.
- [ ] I updated types, tests, documentation, and translations where applicable, or explained why they are not applicable.
- [ ] I recorded exact automated and manual validation results.
- [ ] I disclosed untested paths, risks, limitations, migrations, and rollback behavior.
- [ ] I checked security, privacy, policy, official API, and terms-of-service implications where relevant.
- [ ] I understand any AI-assisted changes and disclosed areas I could not independently verify.
- [ ] I removed secrets, personal identifiers, private URLs, and user data from commits and the PR body.
```

## Writing Rules

- Write the title and body in English.
- Lead with the outcome and explain behavior before implementation detail.
- Separate observed facts from inferences and open questions.
- Report exact validation commands, environments, counts, and results when they are meaningful.
- Do not claim broad compatibility such as “all providers” or “all models” unless that matrix was actually verified.
- Describe preserved behavior as well as the changed path.
- Omit an irrelevant optional section instead of filling it with boilerplate.
- Keep long logs and demonstrations behind links or collapsible `<details>` blocks.
- Avoid a file-by-file diff narration unless the mapping helps reviewers understand the design.

## Draft Versus Ready for Review

Use a draft pull request when validation is incomplete, a design decision remains open, or the change is intentionally seeking early feedback. State the missing gate under **Review Focus / Open Questions**.

Mark the pull request ready only after:

- Required automated checks have completed with observed results.
- Required manual validation has completed, or its absence is explicitly accepted.
- Known risks and untested paths are disclosed.
- The branch is current enough with the base branch for the review to be meaningful.

## Final Publish Check

Immediately before publishing or updating the pull request:

1. Re-read the rendered title and body as a reviewer.
2. Confirm links, issue references, screenshots, and commands are accurate.
3. Compare the PR commit range with the intended scope.
4. Re-run the repository’s sensitive-information sweep.
5. Select draft or ready status from the actual validation state.
