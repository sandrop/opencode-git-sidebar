## Datetime

2026-08-18 12:52:27 CEST

## Project

opencode-git-sidebar

## Title

ADR-0001 -- Use a TUI-only package with split refresh loops

## Context

OpenCode needs Git branch, worktree, working-tree counts, and GitHub pull request status in the session sidebar. Local Git status is cheap and changes frequently, while GitHub status requires the authenticated `gh` CLI and can be slow or unavailable. The plugin must preserve local status when GitHub fails and must not add a server-side runtime solely to collect machine-local data.

## Dispatch surface

The OpenCode TUI loads the package through its `./tui` entrypoint in process. The plugin dispatches read-only `git` and `gh` subprocesses with argument arrays, explicit working directories, timeouts, and cancellation. A fresh-process smoke test imports the packed `./tui` entrypoint and asserts the real sidebar slot-registration side effect.

## Decision

Ship a target-exclusive TUI package that registers one `sidebar_content` slot. Collect local Git and GitHub pull request state through separate refresh loops with independent intervals, failures, stale-state retention, and overlap prevention. Default local refresh to 10 seconds and remote refresh to 30 seconds, with tuple configuration overrides. Render four vertical groups only: Branch, Worktree, Working Tree, and Pull Request.

## Rationale

A TUI-only package is the smallest architecture that can render native sidebar content and access the current OpenCode worktree. Separate refresh loops match the different cost and reliability of local and remote commands. A dual server/TUI package would add a process boundary and lifecycle coordination without improving access to local repository state. A machine-local file plugin would be faster to prototype but would not provide the reusable public package Sandro selected.

## Consequences

Local Git status remains useful when GitHub is unavailable, and users can tune both polling rates without changing code. Context transitions require explicit branch reconciliation so local and remote snapshots cannot mix. The package depends on OpenCode 1.18.18 or newer, Git, and optional authenticated `gh`. The first release intentionally excludes upstream ahead/behind data, non-GitHub providers, and all Git mutations.
