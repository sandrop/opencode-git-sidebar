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
