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

The sidebar displays four vertical groups:

- **Branch**: the active Git branch, or `detached HEAD`
- **Worktree**: the active worktree directory name
- **Working Tree**: staged, modified, and untracked file counts
- **Pull Request**: the current branch's GitHub pull request and check summary

Select the clickable `refresh` action in the Git header to refresh all groups.
The command palette provides the same action as `Git Sidebar: Refresh`.

GitHub integration is optional. Missing `gh`, recognized authentication
errors, and missing or unsupported GitHub remotes show muted
`GitHub unavailable` while the local Git groups continue to work. Pull Request
shows muted `loading`, `refresh failed`, or `no pull request` states separately.
Transient failures retain the last successful Pull Request value as stale.

An initial local Git failure shows muted `Git status unavailable`. Later local
failures retain the last successful Git values as stale. A confirmed non-Git
directory still hides the complete Git section.

## License

MIT
