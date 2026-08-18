# OpenCode Git Sidebar Implementation Plan

<!-- markdownlint-disable MD013 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a publish-ready OpenCode TUI plugin that shows branch, worktree, working-tree counts, and GitHub pull request status in the session sidebar.

**Architecture:** A TUI-only package registers one ordered `sidebar_content` slot. Pure collectors and presenters isolate Git, GitHub, refresh scheduling, and display rules from the OpenTUI JSX entrypoint, while dependency injection keeps subprocess and host integration testable.

**Tech Stack:** TypeScript 7, SolidJS 1.9, OpenCode TUI API 1.18.18, OpenTUI 0.5, Vitest 4, Node subprocess APIs, Git CLI, GitHub CLI

## Global Constraints

- Support OpenCode 1.18.18 or newer through a target-exclusive `./tui` export.
- Use the MIT license.
- Keep Branch, Worktree, Working Tree, and Pull Request as four vertical groups.
- Render one header row and one fact row per group, with dividers between groups.
- Do not add an Upstream group or ahead/behind collection.
- Keep Working Tree and Pull Request facts on one row at 28 visible columns or wider.
- Default local refresh to 10,000 ms and remote refresh to 30,000 ms.
- Accept `localRefreshMs` and `remoteRefreshMs` through `tui.json` tuple options.
- Run only read-only `git` and `gh` commands with argument arrays and explicit working directories.
- Keep local Git working when `gh` is missing, unauthenticated, timed out, or unavailable.
- Ask Sandro for explicit approval before every commit.

---

## File Map

- `package.json`: package metadata, `./tui` export, peer dependencies, scripts, and OpenCode engine floor.
- `tsconfig.json`: shared strict TypeScript and OpenTUI JSX settings.
- `tsconfig.build.json`: declaration and `dist/` build settings.
- `vitest.config.ts`: Node test environment and test discovery.
- `src/tui.tsx`: editable refresh defaults, option parsing, host activation, command registration, and default plugin export.
- `src/command.ts`: safe subprocess runner with timeout and cancellation.
- `src/git.ts`: porcelain parser and local Git collector.
- `src/github.ts`: `gh` JSON parser and pull request collector.
- `src/refresh.ts`: independent local and remote refresh scheduling, overlap prevention, and stale-state retention.
- `src/sidebar.tsx`: pure sidebar view model plus OpenTUI JSX rendering.
- `tests/*.test.ts(x)`: unit, component-contract, integration, and activation tests.
- `tests/smoke-entrypoint.mjs`: fresh-process package-entrypoint smoke test.
- `README.md`: installation, configuration, display, and prerequisites.
- `LICENSE`: MIT license text.
- `.gitignore`: generated package and editor artifacts.

### Task 1: Package Foundation And Refresh Options

**Files:**

- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `LICENSE`
- Create: `src/tui.tsx`
- Create: `tests/options.test.ts`

**Interfaces:**

- Consumes: OpenCode `TuiPlugin`, `TuiPluginModule`, and `TuiPluginApi` types.
- Produces: `DEFAULT_OPTIONS`, `PluginOptions`, `ResolvedOptions`, and `resolveOptions(options)` for later activation and refresh tasks.

- [ ] **Step 1: Add package and compiler configuration**

Create `package.json` with this contract:

```json
{
  "name": "opencode-git-sidebar",
  "version": "0.1.0",
  "description": "OpenCode TUI sidebar for Git and GitHub pull request status",
  "type": "module",
  "license": "MIT",
  "files": ["dist", "README.md", "LICENSE"],
  "exports": {
    "./tui": {
      "types": "./dist/tui.d.ts",
      "import": "./dist/tui.js"
    }
  },
  "engines": {
    "opencode": ">=1.18.18"
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "pack:check": "npm pack --dry-run"
  },
  "peerDependencies": {
    "@opencode-ai/plugin": ">=1.18.18",
    "@opentui/core": ">=0.5.3",
    "@opentui/keymap": ">=0.5.3",
    "@opentui/solid": ">=0.5.3",
    "solid-js": ">=1.9.12"
  },
  "devDependencies": {
    "@opencode-ai/plugin": "1.18.18",
    "@opentui/core": "0.5.3",
    "@opentui/keymap": "0.5.3",
    "@opentui/solid": "0.5.3",
    "@types/node": "^24.0.0",
    "solid-js": "1.9.12",
    "typescript": "7.0.2",
    "vitest": "4.1.10"
  }
}
```

Use strict `NodeNext` module resolution, `react-jsx`, and `@opentui/solid` as `jsxImportSource`. Build declarations and JavaScript from `src/` to `dist/`. Ignore `node_modules/`, `dist/`, coverage output, package tarballs, and `.DS_Store`. Add the standard MIT license text with Sandro as the 2026 copyright holder.

- [ ] **Step 2: Install declared dependencies**

Run: `npm install`

Expected: `package-lock.json` is created and npm reports no dependency-resolution error.

- [ ] **Step 3: Write failing option-resolution tests**

```ts
import { describe, expect, it } from "vitest"
import { DEFAULT_OPTIONS, resolveOptions } from "../src/tui.js"

describe("resolveOptions", () => {
  it("uses the approved refresh defaults", () => {
    expect(DEFAULT_OPTIONS).toEqual({
      localRefreshMs: 10_000,
      remoteRefreshMs: 30_000,
    })
    expect(resolveOptions(undefined)).toEqual(DEFAULT_OPTIONS)
  })

  it("accepts finite positive integer overrides", () => {
    expect(resolveOptions({ localRefreshMs: 2_000, remoteRefreshMs: 60_000 })).toEqual({
      localRefreshMs: 2_000,
      remoteRefreshMs: 60_000,
    })
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1000"])(
    "rejects invalid interval %j",
    (value) => {
      expect(resolveOptions({ localRefreshMs: value }).localRefreshMs).toBe(10_000)
    },
  )
})
```

- [ ] **Step 4: Run the test to verify RED**

Run: `npm test -- tests/options.test.ts`

Expected: FAIL because `src/tui.tsx` does not export the option contract.

- [ ] **Step 5: Implement the minimal option contract at the top of `src/tui.tsx`**

```ts
/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"

export const DEFAULT_OPTIONS = {
  localRefreshMs: 10_000,
  remoteRefreshMs: 30_000,
} as const

export type PluginOptions = {
  localRefreshMs?: unknown
  remoteRefreshMs?: unknown
}

export type ResolvedOptions = {
  localRefreshMs: number
  remoteRefreshMs: number
}

const interval = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0
    ? value
    : fallback

export function resolveOptions(options: PluginOptions | undefined): ResolvedOptions {
  return {
    localRefreshMs: interval(options?.localRefreshMs, DEFAULT_OPTIONS.localRefreshMs),
    remoteRefreshMs: interval(options?.remoteRefreshMs, DEFAULT_OPTIONS.remoteRefreshMs),
  }
}

const tui: TuiPlugin = async () => {}

const plugin: TuiPluginModule & { id: string } = {
  id: "opencode-git-sidebar",
  tui,
}

export default plugin
```

- [ ] **Step 6: Verify the foundation**

Run: `npm test -- tests/options.test.ts && npm run typecheck && npm run build`

Expected: option tests PASS; typecheck and build exit 0; `dist/tui.js` and `dist/tui.d.ts` exist.

- [ ] **Step 7: Review and commit**

Show `git diff`, test output, and `git status`; obtain Sandro's approval; then commit:

```bash
git add package.json package-lock.json tsconfig.json tsconfig.build.json vitest.config.ts .gitignore LICENSE src/tui.tsx tests/options.test.ts
git commit -m "build: scaffold OpenCode TUI plugin"
```

### Task 2: Safe Command Runner And Local Git Collector

**Files:**

- Create: `src/command.ts`
- Create: `src/git.ts`
- Create: `tests/git.test.ts`
- Create: `tests/git-integration.test.ts`

**Interfaces:**

- Consumes: explicit executable, argument list, working directory, timeout, and optional abort signal.
- Produces: `CommandRunner`, `CommandResult`, `runCommand`, `GitState`, `parseGitStatus(output)`, and `collectGitState(input)`.

- [ ] **Step 1: Write failing porcelain parser tests**

```ts
import { describe, expect, it } from "vitest"
import { parseGitStatus } from "../src/git.js"

describe("parseGitStatus", () => {
  it("counts staged, modified, and untracked entries", () => {
    const output = [
      "# branch.head feat/sidebar",
      "1 M. N... 100644 100644 100644 abc abc staged.ts",
      "1 .M N... 100644 100644 100644 abc abc modified.ts",
      "? untracked.ts",
    ].join("\n")

    expect(parseGitStatus(output)).toEqual({
      branch: "feat/sidebar",
      staged: 1,
      modified: 1,
      untracked: 1,
    })
  })

  it("maps a detached branch and clean tree", () => {
    expect(parseGitStatus("# branch.head (detached)\n")).toEqual({
      branch: "detached HEAD",
      staged: 0,
      modified: 0,
      untracked: 0,
    })
  })
})
```

- [ ] **Step 2: Run parser tests to verify RED**

Run: `npm test -- tests/git.test.ts`

Expected: FAIL because `src/git.ts` does not exist.

- [ ] **Step 3: Implement the parser and command contract**

Define this runner boundary in `src/command.ts`:

```ts
export type CommandResult = {
  ok: boolean
  stdout: string
  stderr: string
  reason?: "exit" | "missing" | "timeout" | "aborted"
}

export type CommandRunner = (
  executable: string,
  args: readonly string[],
  input: { cwd: string; timeoutMs: number; signal?: AbortSignal },
) => Promise<CommandResult>
```

Implement `runCommand` with `node:child_process.execFile`, `shell: false`, an explicit `cwd`, an `AbortSignal`, and the supplied timeout. Normalize `ENOENT`, timeout, abort, and non-zero exit into `CommandResult`; never interpolate a shell command string.

Implement `parseGitStatus` by reading `# branch.head`, `1`, `2`, `u`, and `?` records. Count index status as staged, worktree status as modified, and `?` as untracked. Count each path once per category.

- [ ] **Step 4: Add a failing collector test**

```ts
import { expect, it, vi } from "vitest"
import { collectGitState } from "../src/git.js"

it("collects status in the supplied worktree", async () => {
  const runner = vi.fn().mockResolvedValue({
    ok: true,
    stdout: "# branch.head feat/sidebar\n? new.ts\n",
    stderr: "",
  })

  await expect(collectGitState({ cwd: "/repo/sidebar", runner })).resolves.toEqual({
    repository: true,
    branch: "feat/sidebar",
    worktree: "sidebar",
    staged: 0,
    modified: 0,
    untracked: 1,
  })
  expect(runner).toHaveBeenCalledWith(
    "git",
    ["status", "--porcelain=v2", "--branch"],
    expect.objectContaining({ cwd: "/repo/sidebar" }),
  )
})
```

- [ ] **Step 5: Implement `collectGitState`**

Use `basename(cwd)` for Worktree. Return `{ repository: false }` when Git reports a non-repository. Throw a typed collection error for timeout or other failures so the refresh controller can retain stale state. Use a local timeout below 10 seconds, with 2,000 ms as the initial constant.

- [ ] **Step 6: Add a real-repository integration test**

Create a temporary directory with `mkdtemp`, initialize Git, configure repository-local test identity, commit one file, then create one staged file, modify the committed file, and create one untracked file. Invoke `collectGitState` with the real `runCommand` and assert the current branch/worktree plus counts `1 staged`, `1 modified`, and `1 untracked`. Leave the unique temporary directory in place rather than deleting it.

- [ ] **Step 7: Verify local collection**

Run: `npm test -- tests/git.test.ts tests/git-integration.test.ts && npm run typecheck`

Expected: all local Git tests PASS and typecheck exits 0.

- [ ] **Step 8: Review and commit**

Show diff, tests, and status; obtain approval; then commit:

```bash
git add src/command.ts src/git.ts tests/git.test.ts tests/git-integration.test.ts
git commit -m "feat: collect local Git status"
```

### Task 3: GitHub Pull Request Collector

**Files:**

- Create: `src/github.ts`
- Create: `tests/github.test.ts`

**Interfaces:**

- Consumes: `CommandRunner`, worktree path, and current branch.
- Produces: `PullRequestState`, `parsePullRequestJson(output)`, and `collectPullRequest(input)`.

- [ ] **Step 1: Write failing GitHub parser tests**

```ts
import { describe, expect, it } from "vitest"
import { parsePullRequestJson } from "../src/github.js"

describe("parsePullRequestJson", () => {
  it("summarizes passing and pending checks", () => {
    const output = JSON.stringify({
      number: 142,
      state: "OPEN",
      statusCheckRollup: [
        { status: "COMPLETED", conclusion: "SUCCESS" },
        { status: "IN_PROGRESS", conclusion: null },
      ],
    })

    expect(parsePullRequestJson(output)).toEqual({
      kind: "ready",
      number: 142,
      state: "OPEN",
      checks: { total: 2, passing: 1, pending: 1, failing: 0 },
    })
  })

  it("rejects malformed gh output", () => {
    expect(() => parsePullRequestJson("not-json")).toThrow("Invalid gh JSON")
  })
})
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- tests/github.test.ts`

Expected: FAIL because `src/github.ts` does not exist.

- [ ] **Step 3: Implement parsing and check classification**

Define a discriminated union:

```ts
export type PullRequestState =
  | { kind: "ready"; number: number; state: "OPEN" | "CLOSED" | "MERGED"; checks: CheckSummary }
  | { kind: "none" }
  | { kind: "unavailable"; message: "GitHub unavailable" }
```

Treat `SUCCESS`, `NEUTRAL`, and `SKIPPED` as passing; queued, expected, pending, and in-progress states as pending; and all completed non-passing conclusions as failing. Validate `number`, `state`, and `statusCheckRollup` before returning.

- [ ] **Step 4: Write failing collector classification tests**

Cover these command outcomes with an injected runner:

```ts
it.each([
  ["gh missing", { ok: false, stdout: "", stderr: "", reason: "missing" }, "unavailable"],
  ["not authenticated", { ok: false, stdout: "", stderr: "authenticate first", reason: "exit" }, "unavailable"],
  ["no PR", { ok: false, stdout: "", stderr: "no pull requests found for branch", reason: "exit" }, "none"],
])("classifies %s", async (_name, result, kind) => {
  const runner = vi.fn().mockResolvedValue(result)
  await expect(collectPullRequest({ cwd: "/repo", branch: "feat/sidebar", runner })).resolves.toMatchObject({ kind })
})
```

- [ ] **Step 5: Implement `collectPullRequest`**

Run:

```text
gh pr view feat/sidebar --json number,state,statusCheckRollup
```

Use argument-array invocation, explicit `cwd`, and a 10,000 ms timeout. Return `none` only for the recognized no-PR error. Return `unavailable` for missing `gh`, authentication, and unsupported-remote failures. Throw for timeout or unknown failures so stale retention remains possible.

- [ ] **Step 6: Verify GitHub collection**

Run: `npm test -- tests/github.test.ts && npm run typecheck`

Expected: all GitHub tests PASS and typecheck exits 0.

- [ ] **Step 7: Review and commit**

Show diff, tests, and status; obtain approval; then commit:

```bash
git add src/github.ts tests/github.test.ts
git commit -m "feat: collect GitHub pull request status"
```

### Task 4: Independent Refresh Controller

**Files:**

- Create: `src/refresh.ts`
- Create: `tests/refresh.test.ts`

**Interfaces:**

- Consumes: `ResolvedOptions`, context getter, local collector, remote collector, and snapshot callback.
- Produces: `RefreshSnapshot`, `RefreshController`, and `createRefreshController(deps)` with `start`, `refreshLocal`, `refreshRemote`, `refreshAll`, and `dispose`.

- [ ] **Step 1: Write failing timer and immediate-refresh tests**

```ts
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { createRefreshController } from "../src/refresh.js"

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it("runs both collectors immediately and on independent intervals", async () => {
  const local = vi.fn().mockResolvedValue({ repository: true, branch: "feat/sidebar", worktree: "repo", staged: 0, modified: 0, untracked: 0 })
  const remote = vi.fn().mockResolvedValue({ kind: "none" })
  const controller = createRefreshController({
    options: { localRefreshMs: 10_000, remoteRefreshMs: 30_000 },
    context: () => ({ cwd: "/repo", branch: "feat/sidebar" }),
    collectLocal: local,
    collectRemote: remote,
    onChange: vi.fn(),
  })

  controller.start()
  await vi.runAllTicks()
  expect(local).toHaveBeenCalledTimes(1)
  expect(remote).toHaveBeenCalledTimes(1)

  await vi.advanceTimersByTimeAsync(30_000)
  expect(local).toHaveBeenCalledTimes(4)
  expect(remote).toHaveBeenCalledTimes(2)
})
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- tests/refresh.test.ts`

Expected: FAIL because `src/refresh.ts` does not exist.

- [ ] **Step 3: Implement controller lifecycle and state**

Use this public shape:

```ts
export type RefreshController = {
  start(): void
  refreshLocal(): Promise<void>
  refreshRemote(): Promise<void>
  refreshAll(): Promise<void>
  dispose(): void
}
```

`start` is idempotent, refreshes both sources, and starts two intervals. Track one in-flight promise per source; a second request reuses that promise instead of launching overlap. `dispose` clears timers and aborts active commands through one lifecycle `AbortController`.

- [ ] **Step 4: Add stale-retention and context-change tests**

Assert that a successful value remains present with `stale: true` after the next collection throws. Change the context getter from one branch/worktree pair to another before a local tick and assert both local and remote collectors run for the new context. Assert `dispose` prevents later timer calls.

- [ ] **Step 5: Implement stale retention and branch/worktree detection**

Store the last context key as `${cwd}\0${branch}`. Before every local refresh, compare the key; a changed key invalidates old snapshot values and triggers remote refresh after local collection. Keep local and remote error state independent.

- [ ] **Step 6: Verify refresh behavior**

Run: `npm test -- tests/refresh.test.ts && npm run typecheck`

Expected: immediate, interval, overlap, stale, context-change, and disposal tests PASS.

- [ ] **Step 7: Review and commit**

Show diff, tests, and status; obtain approval; then commit:

```bash
git add src/refresh.ts tests/refresh.test.ts
git commit -m "feat: coordinate Git sidebar refreshes"
```

### Task 5: Sidebar View Model And Vertical Renderer

**Files:**

- Create: `src/sidebar.tsx`
- Create: `tests/sidebar.test.tsx`

**Interfaces:**

- Consumes: `RefreshSnapshot`, current theme tokens, and `onRefresh` callback.
- Produces: `SidebarGroup`, `buildSidebarGroups(snapshot, width)`, `GitSidebar(props)`, and `sidebarSlot(api, snapshot, onRefresh)`.

- [ ] **Step 1: Write failing view-model tests**

```ts
import { expect, it } from "vitest"
import { buildSidebarGroups } from "../src/sidebar.js"

it("builds the approved four vertical groups", () => {
  const groups = buildSidebarGroups({
    local: { value: { repository: true, branch: "feat/sidebar", worktree: "cobtask", staged: 2, modified: 3, untracked: 1 }, stale: false },
    remote: { value: { kind: "ready", number: 142, state: "OPEN", checks: { total: 8, passing: 8, pending: 0, failing: 0 } }, stale: false },
  }, 28)

  expect(groups.map((group) => group.header)).toEqual([
    "BRANCH",
    "WORKTREE",
    "WORKING TREE",
    "PULL REQUEST",
  ])
  expect(groups[2].fact).toBe("2 staged | 3 mod | 1 new")
  expect(groups[3].fact).toBe("#142 OPEN | 8/8 passing")
  expect(groups.every((group) => group.fact.length <= 28)).toBe(true)
})

it("hides the section outside a repository", () => {
  expect(buildSidebarGroups({ local: { value: { repository: false }, stale: false }, remote: { value: null, stale: false } }, 28)).toEqual([])
})
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- tests/sidebar.test.tsx`

Expected: FAIL because `src/sidebar.tsx` does not exist.

- [ ] **Step 3: Implement concise fact formatting**

Working Tree omits zero counts and renders `clean` when all counts are zero. Prefer full labels while the row fits; shorten in this order when needed: `modified` to `mod`, `untracked` to `new`, then `staged` to `S`, `modified` to `M`, and `untracked` to `?`. Pull Request renders passing, pending, or failing summaries and shortens `passing` to `ok` only when required to fit 28 columns.

Return four `SidebarGroup` objects with `{ header, fact, tone, stale }`. Never return an Upstream group.

- [ ] **Step 4: Add component-contract tests**

Export `sidebarSlot(api: TuiPluginApi, snapshot: () => RefreshSnapshot, onRefresh: () => void): TuiSlotPlugin`. Test the returned plugin has `order: 75`, exposes only `sidebar_content`, reads `snapshot()` during rendering, renders no content for an empty group list, and invokes `onRefresh` from the header refresh control. Keep the refresh handler on a clickable `<box onMouseUp={...}>`, matching OpenCode's current TUI plugin example.

- [ ] **Step 5: Implement the OpenTUI JSX renderer**

Render one outer column. The first row uses `justifyContent="space-between"` for bold `GIT` and muted/accent `refresh`. Each group renders header text on one row and fact text on the next. Insert a 28-character muted ASCII divider between groups. Use `ctx.theme.current` tokens with safe fallbacks for text, muted, primary, success, warning, error, and border colors.

- [ ] **Step 6: Verify sidebar behavior**

Run: `npm test -- tests/sidebar.test.tsx && npm run typecheck`

Expected: group order, one-row facts, 28-column fit, hidden non-repository state, divider count, theme use, and refresh interaction tests PASS.

- [ ] **Step 7: Review and commit**

Show diff, tests, and status; obtain approval; then commit:

```bash
git add src/sidebar.tsx tests/sidebar.test.tsx
git commit -m "feat: render vertical Git sidebar"
```

### Task 6: OpenCode Activation And Fresh-Process Smoke Test

**Files:**

- Modify: `src/tui.tsx`
- Create: `tests/activation.test.ts`
- Create: `tests/smoke-entrypoint.mjs`
- Create: `tests/entrypoint-smoke.test.ts`

**Interfaces:**

- Consumes: host `TuiPluginApi`, resolved options, command runner, collectors, refresh controller, and sidebar slot.
- Produces: `activate(api, options, dependencies?)`, command `git-sidebar.refresh`, plugin id `opencode-git-sidebar`, and the package `./tui` entrypoint.

- [ ] **Step 1: Write a failing activation test**

Build a minimal host API that records slot plugins, command layers, and disposal callbacks. Inject collectors and a refresh-controller factory. Assert:

```ts
await activate(api, { localRefreshMs: 5_000 }, deps)

expect(api.slots.register).toHaveBeenCalledTimes(1)
expect(api.keymap.registerLayer).toHaveBeenCalledWith({
  commands: [expect.objectContaining({
    name: "git-sidebar.refresh",
    title: "Git Sidebar: Refresh",
    category: "Plugin",
    namespace: "palette",
  })],
})
expect(deps.createRefreshController).toHaveBeenCalledWith(
  expect.objectContaining({ options: { localRefreshMs: 5_000, remoteRefreshMs: 30_000 } }),
)
```

- [ ] **Step 2: Run activation tests to verify RED**

Run: `npm test -- tests/activation.test.ts`

Expected: FAIL because `activate` and host wiring do not exist.

- [ ] **Step 3: Implement host activation**

Use `api.state.path.worktree || api.state.path.directory` for `cwd` and `api.state.vcs?.branch` for branch. Create one Solid signal holding `RefreshSnapshot`; pass its getter to the slot factory and update it from `onChange`. Register the palette command so `run()` calls `controller.refreshAll()`. Start the controller after registrations. Register `controller.dispose` with `api.lifecycle.onDispose`.

Keep the default export target-exclusive:

```ts
const tui: TuiPlugin = async (api, options) => {
  await activate(api, options)
}

const plugin: TuiPluginModule & { id: string } = {
  id: "opencode-git-sidebar",
  tui,
}

export default plugin
```

- [ ] **Step 4: Write the fresh-process smoke script**

`tests/smoke-entrypoint.mjs` must import the package self-reference:

```js
import plugin from "opencode-git-sidebar/tui"

const registered = []
const api = createSmokeApi(registered)
await plugin.tui(api, { localRefreshMs: 60_000, remoteRefreshMs: 60_000 }, { state: "same" })

if (plugin.id !== "opencode-git-sidebar") process.exit(2)
if (registered.length !== 1) process.exit(3)
process.stdout.write(JSON.stringify({ plugin: plugin.id, sidebarSlots: registered.length }))
await api.dispose()
```

Define `createSmokeApi` in the same script with real registration arrays, live path/vcs state, lifecycle disposal, and command-layer capture. The script must exercise actual built package loading and slot registration, not import source files.

- [ ] **Step 5: Add the parent smoke test**

Build the package, spawn `node tests/smoke-entrypoint.mjs` in a fresh process, and assert exit code 0 plus exact JSON `{ "plugin": "opencode-git-sidebar", "sidebarSlots": 1 }`.

- [ ] **Step 6: Verify activation and package boundary**

Run: `npm test -- tests/activation.test.ts && npm run build && npm test -- tests/entrypoint-smoke.test.ts`

Expected: activation tests PASS; fresh process imports `./tui` and reports one real sidebar registration.

- [ ] **Step 7: Review and commit**

Show diff, tests, and status; obtain approval; then commit:

```bash
git add src/tui.tsx tests/activation.test.ts tests/smoke-entrypoint.mjs tests/entrypoint-smoke.test.ts
git commit -m "feat: activate Git sidebar in OpenCode"
```

### Task 7: Documentation, Package Inspection, And Local Install Smoke

**Files:**

- Create: `README.md`
- Modify: `docs/superpowers/specs/2026-08-15-opencode-git-sidebar-design.md`

**Interfaces:**

- Consumes: final package commands and `tui.json` option names.
- Produces: user installation/configuration documentation and verified package contents.

- [ ] **Step 1: Write README usage and configuration**

Document prerequisites: OpenCode 1.18.18+, Git, and optional authenticated `gh`. Include:

```bash
opencode plugin opencode-git-sidebar --global
```

Show tuple configuration:

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

Explain the four groups, clickable header refresh, `Git Sidebar: Refresh` command, missing-`gh` behavior, source defaults in `src/tui.tsx`, and the requirement to restart OpenCode after config changes.

- [ ] **Step 2: Record the MIT decision in the design**

Add `MIT-licensed public package` to the design Scope and add MIT to the package-maintenance assumptions. Do not change approved runtime behavior.

- [ ] **Step 3: Run the complete verification gate**

Run:

```bash
npm run typecheck
npm test
npm run build
npm run pack:check
pre-commit run --files package.json package-lock.json tsconfig.json tsconfig.build.json vitest.config.ts src/*.ts src/*.tsx tests/*.ts tests/*.tsx tests/*.mjs README.md LICENSE docs/superpowers/specs/2026-08-15-opencode-git-sidebar-design.md docs/superpowers/plans/2026-08-15-opencode-git-sidebar.md
```

Expected: no skipped test files, all tests PASS, build exits 0, package dry run contains only `dist/`, `README.md`, `LICENSE`, and package metadata, and all applicable pre-commit hooks PASS.

- [ ] **Step 4: Run a temporary-config OpenCode install smoke**

Create unique directories under `/var/folders/4j/z1pv14ns4lzcz2yz1lvkfbzm0000gn/T/opencode`, pack the plugin there, and point `OPENCODE_CONFIG_DIR` at a second unique directory. Install the generated tarball with `opencode plugin <absolute-tarball-path>`. Assert the generated `tui.json` contains the package spec and OpenCode starts far enough to report version 1.18.18 without config errors. Leave the unique smoke directories in place.

Do not modify Sandro's global OpenCode config during this smoke test.

- [ ] **Step 5: Inspect the final diff and repository state**

Run: `git status --short`, `git diff --check`, `git diff --stat`, and `git log --oneline -10`.

Expected: only README and the approved design-license update remain uncommitted; no generated `dist/`, tarball, temporary config, or secret is tracked.

- [ ] **Step 6: Review and commit**

Show the complete verification output and final diff; obtain Sandro's approval; then commit:

```bash
git add README.md docs/superpowers/specs/2026-08-15-opencode-git-sidebar-design.md
git commit -m "docs: document Git sidebar installation"
```

- [ ] **Step 7: Stop before publication or global installation**

Report the package tarball path, temporary install result, branch status, and all verification results. Ask Sandro separately before creating the public GitHub remote, publishing to npm, pushing, opening a PR, or installing into the global OpenCode configuration.
