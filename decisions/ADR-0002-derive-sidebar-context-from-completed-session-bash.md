---
status: active
active_at: 2026-09-18
retired_at:
superseded_by:
---
## Datetime

2026-09-18 16:58:50 EDT

## Project

opencode-git-sidebar

## Title

ADR-0002 -- Derive sidebar context from completed session Bash workdirs

## Context

OPS-0021 exposed a mismatch between the agent's selected checkout and OpenCode's launch directory. A resumed task used a feature worktree through explicit Bash `workdir` arguments, while global paths and stored `Session.directory` still identified the launch repository. The sidebar collected the launch repository's branch, status, and PR.

OpenCode's TUI API exposes the routed session's messages and tool parts, including structured Bash inputs and call timestamps. Sandro approved using that data to follow the checkout where the agent runs commands.

## Dispatch surface

n/a (no new dispatch surface). The existing `./tui` entrypoint reads session tool parts in process. The existing read-only Git and `gh` subprocesses receive the resolved directory. The fresh-process entrypoint test checks sidebar registration, and the real-Git integration test checks collection in a linked worktree.

## Decision

- For a loaded session, select its latest completed `bash` tool part with an absolute string `input.workdir`. Order candidates by call start time, then part ID; a slow older call cannot replace a newer directory.
- Use only the routed session's tool parts. Ignore unfinished or failed calls and invalid workdirs. Read structured directory fields without parsing shell commands or outputs.
- Fall back to `Session.directory` when no qualifying call is available. Non-session routes use the global directory; unloaded session metadata leaves collection pending and clears the previous context.
- Resolve the Git checkout root and branch from the selected directory before PR lookup. Keep the existing tracked-upstream PR lookup and separate refresh intervals.
- Display the selected directory as Working Directory and the Git root as Worktree. Both values may be equal.

## Rationale

Structured `workdir` matches the observed resume workflow and is available through the current TUI-only package. The field also provides a deterministic ordering rule without adding a directory tracker or persistent override.

Global and stored-session paths remain useful fallbacks, but neither identified the adopted checkout in the reported workflow. An explicit checkout picker would require another user action. Shell-text parsing would need to interpret nested commands, quoting, and `git -C` separately from the tool's actual working directory.

## Consequences

- An explicit Bash call in another checkout changes the selected sidebar directory on the next refresh, including diagnostic commands.
- Selection depends on tool parts OpenCode has loaded. If history or compaction removes the qualifying call, the session-directory fallback applies.
- Shell text such as `cd` and `git -C` does not change selection without a structured `workdir` argument.
- Context changes clear old snapshots and reject delayed results. Local collection failures preserve stale data only within the same context.
- ADR-0001's TUI-only package and split refresh intervals continue to apply.
