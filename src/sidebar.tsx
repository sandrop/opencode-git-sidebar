/** @jsxImportSource @opentui/solid */
import { createTextAttributes } from "@opentui/core"
import type {
  TuiPluginApi,
  TuiSlotPlugin,
  TuiThemeCurrent,
} from "@opencode-ai/plugin/tui"
import type { RefreshSnapshot } from "./refresh.js"

const SIDEBAR_WIDTH = 28

type SidebarTheme = Partial<
  Pick<TuiThemeCurrent, "text" | "textMuted" | "primary" | "success" | "warning" | "error" | "border">
>

const fallbackTheme = {
  text: "#d7d7d7",
  muted: "#808080",
  primary: "#5f87ff",
  success: "#5faf5f",
  warning: "#d7af5f",
  error: "#d75f5f",
  border: "#585858",
} as const

export type SidebarGroup = {
  header: "BRANCH" | "WORKTREE" | "WORKING TREE" | "PULL REQUEST"
  fact: string
  tone: "text" | "primary" | "success" | "warning" | "error"
  stale: boolean
}

function fit(value: string, width: number): string {
  return value.length <= width ? value : value.slice(0, Math.max(0, width))
}

function workingTreeFact(
  state: { staged: number; modified: number; untracked: number },
  width: number,
): string {
  if (state.staged === 0 && state.modified === 0 && state.untracked === 0) return "clean"

  const labels = [
    ["staged", "modified", "untracked"],
    ["staged", "mod", "untracked"],
    ["staged", "mod", "new"],
    ["S", "mod", "new"],
    ["S", "M", "new"],
    ["S", "M", "?"],
  ] as const
  const counts = [state.staged, state.modified, state.untracked]
  const facts = labels.map((row) =>
    counts
      .map((count, index) => (count > 0 ? `${count} ${row[index]}` : ""))
      .filter(Boolean)
      .join(" | "),
  )
  return facts.find((fact) => fact.length <= width) ?? fit(facts.at(-1) ?? "", width)
}

function pullRequestFact(snapshot: RefreshSnapshot, width: number): string {
  const remote = snapshot.remote.value
  if (!remote || remote.kind === "none") return "none"
  if (remote.kind === "unavailable") return fit(remote.message, width)

  const checks = remote.checks
  const summary =
    checks.failing > 0
      ? `${checks.failing}/${checks.total} failing`
      : checks.pending > 0
        ? `${checks.pending}/${checks.total} pending`
        : `${checks.passing}/${checks.total} passing`
  let fact = `#${remote.number} ${remote.state} | ${summary}`
  if (fact.length > width && checks.failing === 0 && checks.pending === 0) {
    fact = fact.replace(" passing", " ok")
  }
  return fit(fact, width)
}

function pullRequestTone(snapshot: RefreshSnapshot): SidebarGroup["tone"] {
  const remote = snapshot.remote.value
  if (remote?.kind === "unavailable") return "error"
  if (!remote || remote.kind === "none") return "text"
  if (remote.checks.failing > 0) return "error"
  if (remote.checks.pending > 0) return "warning"
  return "success"
}

export function buildSidebarGroups(snapshot: RefreshSnapshot, width: number): SidebarGroup[] {
  const local = snapshot.local.value
  if (!local?.repository) return []

  return [
    {
      header: "BRANCH",
      fact: fit(local.branch, width),
      tone: "primary",
      stale: snapshot.local.stale,
    },
    {
      header: "WORKTREE",
      fact: fit(local.worktree, width),
      tone: "text",
      stale: snapshot.local.stale,
    },
    {
      header: "WORKING TREE",
      fact: workingTreeFact(local, width),
      tone:
        local.staged === 0 && local.modified === 0 && local.untracked === 0 ? "success" : "warning",
      stale: snapshot.local.stale,
    },
    {
      header: "PULL REQUEST",
      fact: pullRequestFact(snapshot, width),
      tone: pullRequestTone(snapshot),
      stale: snapshot.remote.stale,
    },
  ]
}

export type GitSidebarProps = {
  snapshot: RefreshSnapshot
  theme?: SidebarTheme
  onRefresh: () => void
  width?: number
}

export function GitSidebar(props: GitSidebarProps) {
  const width = props.width ?? SIDEBAR_WIDTH
  const groups = buildSidebarGroups(props.snapshot, width)
  if (groups.length === 0) return null

  const theme = {
    text: props.theme?.text ?? fallbackTheme.text,
    muted: props.theme?.textMuted ?? fallbackTheme.muted,
    primary: props.theme?.primary ?? fallbackTheme.primary,
    success: props.theme?.success ?? fallbackTheme.success,
    warning: props.theme?.warning ?? fallbackTheme.warning,
    error: props.theme?.error ?? fallbackTheme.error,
    border: props.theme?.border ?? fallbackTheme.border,
  }
  const tones = {
    text: theme.text,
    primary: theme.primary,
    success: theme.success,
    warning: theme.warning,
    error: theme.error,
  }

  return (
    <box flexDirection="column" width={width}>
      <box flexDirection="row" justifyContent="space-between" width={width}>
        <text fg={theme.text} attributes={createTextAttributes({ bold: true })}>
          GIT
        </text>
        <box onMouseUp={props.onRefresh}>
          <text fg={theme.primary}>refresh</text>
        </box>
      </box>
      {groups.map((group, index) => (
        <>
          {index > 0 ? <text fg={theme.border}>{"-".repeat(width)}</text> : null}
          <text fg={theme.muted}>{group.header}</text>
          <text fg={group.stale ? theme.muted : tones[group.tone]}>{group.fact}</text>
        </>
      ))}
    </box>
  )
}

export function sidebarSlot(
  api: TuiPluginApi,
  snapshot: () => RefreshSnapshot,
  onRefresh: () => void,
): TuiSlotPlugin {
  return {
    order: 75,
    slots: {
      sidebar_content: (ctx) => (
        <GitSidebar
          snapshot={snapshot()}
          theme={ctx.theme?.current ?? api.theme?.current}
          onRefresh={onRefresh}
          width={SIDEBAR_WIDTH}
        />
      ),
    },
  }
}
