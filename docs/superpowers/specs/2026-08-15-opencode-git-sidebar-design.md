# OpenCode Git Sidebar Design

Date: 2026-08-15
Status: Approved

## Goal

Create a reusable OpenCode TUI plugin that shows current Git and GitHub pull
request information in the session sidebar without consuming chat context.

## Scope

The first version supports:

- Current Git branch
- Current Git worktree path
- Current working-tree path
- Staged, modified, and untracked file counts in a separate Status group
- Current GitHub pull request number, state, and check summary
- Automatic local and remote refresh loops
- Clickable and command-palette manual refresh
- GitHub access through the authenticated `gh` CLI
- Distribution as an MIT-licensed public package

OPS-0013 refines the sidebar paths and pull request lookup while retaining the
existing status counts and refresh behavior.

The first version does not support:

- Upstream ahead or behind counts
- GitLab, Bitbucket, or Gitea
- Git mutations such as stage, commit, checkout, or push
- Pull request review controls
- npm publication or GitHub remote creation during initial implementation

## Package Architecture

`opencode-git-sidebar` is a TUI-only TypeScript package. The package exports a
target-exclusive `./tui` entrypoint compatible with OpenCode 1.18.18 or newer.
The default export follows the OpenCode TUI module shape and registers one
`sidebar_content` component through `api.slots.register(...)`.
Package maintenance assumes public npm distribution under the MIT license.

The plugin uses SolidJS signals for collected state and OpenTUI primitives for
rendering. The plugin reads the active branch and worktree from `api.state` and
runs read-only `git` and `gh` subprocesses in the active worktree.

The command runner must spawn commands with argument arrays and an explicit
working directory. The plugin must not build shell command strings from paths
or command output.

## Sidebar Layout

The sidebar is one vertical stack. Each group has one header row and one fact
row. A divider separates adjacent groups.

```text
GIT                                      refresh

BRANCH
feat/sidebar
-----------------------------------------------
WORKTREE
worktrees/feat-sidebar
-----------------------------------------------
WORKING TREE
repo/src
-----------------------------------------------
STATUS
3 modified  |  1 untracked
-----------------------------------------------
PULL REQUEST
#142 OPEN   |  8/8 passing
```

The implementation uses theme tokens rather than fixed colors. The fact row
must stay on one line at 28 visible columns or wider. The renderer may shorten
check text before wrapping, but must not combine group headers and facts on one
row.

Worktree and Working Tree show compact `parent/basename` paths and truncate them
to the available width. Status retains staged, modified, and untracked counts,
omits zero-valued facts, and shows `clean` when all counts are zero. Pull Request
shows the explicit `no pull request` state when lookup succeeds but finds no
associated pull request.

The `refresh` header action is clickable. The same action is available from the
command palette with command id `git-sidebar.refresh` and title
`Git Sidebar: Refresh`.

## Data Collection

### Local Git

The local collector runs `git status --porcelain=v2 --branch` and parses staged,
modified, and untracked entries. OpenCode state supplies the current branch when
available; porcelain output provides the fallback for detached or transitional
states.

The Worktree group displays `api.state.path.worktree` in compact
`parent/basename` form. The collector falls back to `api.state.path.directory`
only when OpenCode has not resolved the worktree path. The Working Tree group
displays `api.state.path.directory` in the same compact form. The Status group
retains the staged, modified, and untracked counts parsed from porcelain output.

### GitHub Pull Request

The remote collector first asks Git for the tracked upstream's remote ref with
`git for-each-ref --format=%(upstream:remoteref) refs/heads/<local-branch>`.
It removes the `refs/heads/` prefix and runs `gh pr view` for that head, so remote
names containing `/` require no parsing. When no upstream is configured, it
falls back to the active local branch. A detached HEAD returns the explicit
`no pull request` state without a GitHub lookup. The command requests JSON fields
for PR number, state, and status checks. The collector reduces check results to
a concise passed/total summary. Failed, pending, or cancelled checks must remain
distinguishable from a fully passing result. A successful lookup with no match
returns the explicit `no pull request` state.

GitHub lookup is optional. Missing `gh`, missing authentication, or a repository
without a GitHub remote must not affect local Git information.

## Refresh Configuration

The top of `src/tui.tsx` contains editable defaults:

```ts
export const DEFAULT_OPTIONS = {
  localRefreshMs: 10_000,
  remoteRefreshMs: 30_000,
}
```

The plugin also accepts `localRefreshMs` and `remoteRefreshMs` through the
OpenCode `tui.json` plugin tuple. Tuple values override source defaults. Values
must be finite positive integers; invalid values fall back to defaults.

Both collectors run immediately after activation and after a branch or worktree
change. Local Git follows `localRefreshMs`; GitHub follows `remoteRefreshMs`.
Manual refresh runs both collectors immediately without creating duplicate
overlapping requests.

## Failure Behavior

- Outside a Git repository, the plugin hides the complete Git section.
- A detached repository shows `detached HEAD` under Branch.
- Missing or unauthenticated `gh` shows muted `GitHub unavailable` under Pull
  Request.
- A command timeout preserves the last successful value and marks that group
  stale.
- Initial command failure shows a concise muted state instead of an empty row.
- Local and remote collectors fail independently.
- Plugin disposal cancels timers and in-flight command work.

Local Git commands have a short timeout. Remote `gh` commands have a longer
timeout. Exact timeout constants remain private implementation details and must
stay below their corresponding refresh intervals.

## Testing

Unit tests cover:

- Git porcelain parsing for clean, staged, modified, untracked, detached, and
  mixed states
- GitHub JSON parsing for open, closed, merged, passing, pending, failing, and
  absent pull requests
- Option validation and default fallback
- Independent local and remote refresh scheduling
- Overlap prevention and stale-state retention
- Zero-count omission and one-row fact formatting

Component tests cover:

- Five vertical groups in the approved order
- One header row and one fact row per group
- Dividers between groups
- Compact `parent/basename` Worktree and Working Tree paths
- Retained staged, modified, and untracked counts under Status
- Explicit `no pull request` rendering
- Theme-token status styling
- Clickable header refresh
- Command-palette refresh registration
- Hidden state outside a Git repository

Integration verification uses a temporary real Git repository to assert branch,
worktree, staged, modified, and untracked reporting. A fresh-subprocess smoke
test imports the built `./tui` entrypoint, activates the plugin against a test
API, and asserts the real sidebar slot registration side effect.

The release gate runs typecheck, unit and component tests, integration tests,
build, package-content inspection, and a local OpenCode installation smoke test.

## Risks And Mitigations

- OpenCode TUI API churn: declare `engines.opencode`, isolate host API use in the
  entrypoint, and test the built entrypoint in a fresh subprocess.
- Slow GitHub calls: use an independent 30-second default interval, timeout each
  request, and retain the last successful state.
- Narrow sidebar wrapping: keep facts concise, omit zero counts, and test at 28
  visible columns.
- Subprocess safety: use fixed executables, argument arrays, explicit working
  directories, and read-only commands.

## Acceptance Criteria

1. OpenCode 1.18.18 loads the package through its `./tui` export.
2. The sidebar shows Branch, Worktree, Working Tree, Status, and Pull Request as
   vertical groups with separate header and fact rows.
3. Status and Pull Request facts each stay on one row and use visual
   dividers between facts.
4. Worktree and Working Tree show compact `parent/basename` paths, while Status
   retains staged, modified, and untracked counts.
5. Pull request lookup uses the tracked upstream head, falls back to the local
   branch when no upstream exists, and shows `no pull request` for no match.
6. The sidebar contains no Upstream group.
7. Local Git refresh defaults to 10 seconds and remote refresh defaults to 30
   seconds.
8. Source defaults and `tui.json` tuple options can adjust both refresh rates.
9. The header refresh action and command-palette action refresh local and remote
   state immediately.
10. Missing GitHub access cannot break local Git status.
11. All verification gates described above pass.
