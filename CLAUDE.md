# CLAUDE.md

Project instructions for AI coding agents working in this repository.
`agents.md` contains the full agent rule set — read it first. The rules below
are the standing, non-negotiable requirements.

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

## Commits are granular and real

- Commit after every logical or incremental change, no matter how small, and
  push immediately. Never bundle unrelated changes, never batch a feature
  into one giant commit, and never create empty/placeholder commits — every
  commit must correspond to an actual intentional change.
