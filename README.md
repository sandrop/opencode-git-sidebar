# OpenCode Git Sidebar

An OpenCode TUI plugin that shows Git worktree status and GitHub pull request
status in the session sidebar.

## Prerequisites

- OpenCode 1.18.18 or newer
- Git
- Optional: an authenticated GitHub CLI (`gh`) for pull request status

## Installation

Install the package in the global OpenCode TUI configuration:

```bash
opencode plugin opencode-git-sidebar --global
```

Quit and restart OpenCode after installation or configuration changes.

## Configuration

The plugin accepts local and remote refresh intervals in milliseconds through
the `tui.json` plugin tuple:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    [
      "opencode-git-sidebar",
      {
        "localRefreshMs": 10000,
        "remoteRefreshMs": 30000
      }
    ]
  ]
}
```

Both values must be finite positive integers. Invalid values use the defaults:

- `localRefreshMs`: 10,000 ms
- `remoteRefreshMs`: 30,000 ms

The source defaults are exported as `DEFAULT_OPTIONS` near the top of
`src/tui.tsx`.

## Sidebar

The sidebar displays five vertical groups:

- **Branch**: the active Git branch, or `detached HEAD`
- **Worktree**: the Git checkout root in compact `parent/basename` form
- **Working Directory**: the selected working directory in compact `parent/basename`
  form
- **Status**: retained staged, modified, and untracked file counts
- **Pull Request**: the current branch's GitHub pull request and check summary

OPS-0013 introduced this five-group layout. Long branch names and compact paths
wrap across lines within the host sidebar's content width. The plugin inherits
OpenCode's padding and adjusts its dividers and summaries when the available
width changes. Status omits zero-valued counts and shows `clean` when all three
counts are zero.

In a session, the plugin selects the latest completed Bash call with an explicit,
absolute `workdir` from the tool parts available in OpenCode's session history.
Call start time determines the order; a slower older call can't replace a newer
directory. Calls with equal start times use the part ID as a tie-breaker. This
lets a resumed task follow the agent's worktree even when `Session.directory`
still points to the launch repository.

An explicit Bash call in another checkout changes the selected directory.
Commands without a `workdir`, shell text such as `cd` or `git -C`, and command
outputs don't set the directory. When no qualifying call is available, the
plugin uses the loaded session's directory. Non-session routes use OpenCode's
global directory. While session metadata is unavailable, the plugin clears the
previous Git section and waits for metadata before collecting again. History
that OpenCode hasn't loaded, including older tool parts removed by compaction,
can't supply a workdir; the session-directory fallback applies in that case.

Git resolves Worktree with `git rev-parse --show-toplevel` from the selected
directory. Worktree and Working Directory are equal at a checkout root, including a
linked worktree, and differ when the selected directory is below that root.
Directory changes take effect on the next refresh. For a new context, PR lookup
waits for Git to resolve the checkout root and branch; local and remote polling
then use their configured intervals. Delayed results from a previous context
can't replace the current values after refresh observes the change.

Select the clickable `refresh` action in the Git header to refresh all groups.
The command palette provides the same action as `Git Sidebar: Refresh`.

GitHub integration is optional. Missing `gh`, recognized authentication
errors, and missing or unsupported GitHub remotes show muted
`GitHub unavailable` while the local Git groups continue to work. Pull Request
shows muted `loading`, `refresh failed`, or `no pull request` states separately.
Transient failures retain the last successful Pull Request value as stale.
Pull request lookup uses the tracked upstream head when one exists and falls
back to the active local branch when no upstream is configured. A successful
lookup with no matching pull request explicitly shows `no pull request`.

An initial local Git failure shows muted `Git status unavailable`. Later local
failures retain the last successful Git values as stale. A confirmed non-Git
directory still hides the complete Git section.

## Development

Run `npm test`, `npm run typecheck`, and `npm run build` to verify changes.
The sidebar wrapping test requires `bun` on PATH to run OpenTUI's native renderer
in a subprocess with Solid's reactive browser export. It checks complete long
branch names and compact paths in a padded terminal frame, then resizes the
frame to verify right-edge placement and summary formatting. Unit tests also
verify that Unicode fact strings retain all characters.

## License

MIT
