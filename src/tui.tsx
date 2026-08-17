/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createSignal } from "solid-js"
import { runCommand, type CommandRunner } from "./command.js"
import { collectGitState } from "./git.js"
import { collectPullRequest } from "./github.js"
import {
  createRefreshController,
  type RefreshSnapshot,
} from "./refresh.js"
import { sidebarSlot } from "./sidebar.js"

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

export type ActivationDependencies = {
  runner: CommandRunner
  collectLocal: typeof collectGitState
  collectRemote: typeof collectPullRequest
  createRefreshController: typeof createRefreshController
}

const defaultDependencies: ActivationDependencies = {
  runner: runCommand,
  collectLocal: collectGitState,
  collectRemote: collectPullRequest,
  createRefreshController,
}

export async function activate(
  api: TuiPluginApi,
  options: PluginOptions | undefined,
  dependencies: Partial<ActivationDependencies> = {},
): Promise<void> {
  const deps = { ...defaultDependencies, ...dependencies }
  const [snapshot, setSnapshot] = createSignal<RefreshSnapshot>({
    local: { value: null, stale: false },
    remote: { value: null, stale: false },
  })
  const controller = deps.createRefreshController({
    options: resolveOptions(options),
    context: () => ({
      cwd: api.state.path.worktree || api.state.path.directory,
      branch: api.state.vcs?.branch ?? "",
    }),
    collectLocal: ({ cwd, signal }) => deps.collectLocal({ cwd, signal, runner: deps.runner }),
    collectRemote: ({ cwd, branch, signal }) =>
      deps.collectRemote({ cwd, branch, signal, runner: deps.runner }),
    onChange: (next) => setSnapshot(next),
  })

  api.slots.register(sidebarSlot(api, snapshot, () => void controller.refreshAll()))
  api.keymap.registerLayer({
    commands: [
      {
        name: "git-sidebar.refresh",
        title: "Git Sidebar: Refresh",
        category: "Plugin",
        namespace: "palette",
        run: () => controller.refreshAll(),
      },
    ],
  })
  api.lifecycle.onDispose(controller.dispose)
  controller.start()
}

const tui: TuiPlugin = async (api, options) => {
  await activate(api, options)
}

const plugin: TuiPluginModule & { id: string } = {
  id: "opencode-git-sidebar",
  tui,
}

export default plugin
