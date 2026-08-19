# Agent Rules

Rules for every agent (Codebuff and any other tool/agent) working in this
repository.

## Commit after every single change — never bundle

- **Commit after every logical or incremental change, no matter how small.**
  One-line fix, README tweak, typo fix, config change, dependency bump,
  formatting change, import added, test added — each gets its own commit.
- **Never wait to bundle updates into a major feature.** Do not hold commits
  until a feature is "done". If a change is real and verified, commit it
  immediately.
- **Push/sync immediately after each commit** so the remote always reflects
  the latest commit.
- Examples of granular commits (each separate):
  - write 1 line of code → commit
  - add an import → commit
  - fix a type error → commit
  - update docs → commit
- **Never create fake/no-op commits.** Every commit must represent a real
  change to the working tree.
- Keep commit messages short and descriptive of the single change.
- Do not batch unrelated changes into one commit — one logical change per
  commit.

## Commit identity — always the repository owner's

- **Never create a commit using an AI agent identity** — no Codebuff, Claude,
  bot, GitHub Actions, or any other non-human author identity, in the author
  field, the message body, or as a trailer.
- Every commit in this project must use the repository owner's configured Git
  identity. **Before every commit, verify `git config user.name` and
  `git config user.email`** and confirm they are the owner's.
- **Never change Git identity automatically.** If the configured identity is
  not the owner's, stop and ask — do not rewrite it.
- Expected owner identity for this repository:
  - user.name: `Ojasvi goel`
  - user.email: `ojasvigoel598@gmail.com`
- No AI/agent attribution trailers (e.g. "Generated with ...",
  "Co-Authored-By: ...") may be added to any commit message.
