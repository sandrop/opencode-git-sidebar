/** @jsxImportSource @opentui/solid */
import { basename, dirname } from "node:path"
import { createTextAttributes } from "@opentui/core"
import type {
  TuiPluginApi,
  TuiSlotPlugin,
  TuiThemeCurrent,
} from "@opencode-ai/plugin/tui"
import stringWidth from "string-width"
import type { RefreshSnapshot } from "./refresh.js"

const SIDEBAR_WIDTH = 28
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

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
  header: "BRANCH" | "WORKTREE" | "WORKING TREE" | "PULL REQUEST" | "STATUS"
  fact: string
  tone: "text" | "muted" | "primary" | "success" | "warning" | "error"
  stale: boolean
}

function fit(value: string, width: number): string {
  const maxWidth = Math.max(0, width)
  if (stringWidth(value) <= maxWidth) return value

  let result = ""
  let resultWidth = 0
  for (const { segment } of graphemeSegmenter.segment(value)) {
    const segmentWidth = stringWidth(segment)
    if (resultWidth + segmentWidth > maxWidth) break
    result += segment
    resultWidth += segmentWidth
  }
  return result
}

function compactPath(value: string, width: number): string {
  const name = basename(value)
  const parent = basename(dirname(value))
  return fit(parent ? `${parent}/${name}` : name || value, width)
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
  return facts.find((fact) => stringWidth(fact) <= width) ?? fit(facts.at(-1) ?? "", width)
}

function pullRequestFact(snapshot: RefreshSnapshot, width: number): string {
  const remote = snapshot.remote.value
  if (snapshot.remote.status === "loading") return "loading"
  if (snapshot.remote.status === "error") return "refresh failed"
  if (!remote) return "loading"
  if (remote.kind === "none") return "no pull request"
  if (remote.kind === "unavailable") return fit(remote.message, width)

  const checks = remote.checks
  const summary =
    checks.failing > 0
      ? `${checks.failing}/${checks.total} failing`
      : checks.pending > 0
        ? `${checks.pending}/${checks.total} pending`
        : `${checks.passing}/${checks.total} passing`
  let fact = `#${remote.number} ${remote.state} | ${summary}`
  if (stringWidth(fact) > width && checks.failing === 0 && checks.pending === 0) {
    fact = fact.replace(" passing", " ok")
  }
  return fit(fact, width)
}

function pullRequestTone(snapshot: RefreshSnapshot): SidebarGroup["tone"] {
  const remote = snapshot.remote.value
  if (snapshot.remote.status !== "ready" || !remote || remote.kind !== "ready") return "muted"
  if (remote.checks.failing > 0) return "error"
  if (remote.checks.pending > 0) return "warning"
  return "success"
}

export function buildSidebarGroups(snapshot: RefreshSnapshot, width: number): SidebarGroup[] {
  const local = snapshot.local.value
  if (snapshot.local.status === "error" && !local) {
    return [
      {
        header: "STATUS",
        fact: "Git status unavailable",
        tone: "muted",
        stale: false,
      },
    ]
  }
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
      fact: compactPath(local.worktreePath, width),
      tone: "text",
      stale: snapshot.local.stale,
    },
    {
      header: "WORKING TREE",
      fact: compactPath(local.workingTreePath, width),
      tone: "text",
      stale: snapshot.local.stale,
    },
    {
      header: "STATUS",
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
}

export function GitSidebar(props: GitSidebarProps) {
  const groups = buildSidebarGroups(props.snapshot, SIDEBAR_WIDTH)
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
    muted: theme.muted,
    primary: theme.primary,
    success: theme.success,
    warning: theme.warning,
    error: theme.error,
  }

  return (
    <box flexDirection="column" width={SIDEBAR_WIDTH}>
      <box flexDirection="row" justifyContent="space-between" width={SIDEBAR_WIDTH}>
        <text fg={theme.text} attributes={createTextAttributes({ bold: true })}>
          GIT
        </text>
        <box onMouseUp={props.onRefresh}>
          <text fg={theme.primary}>refresh</text>
        </box>
      </box>
      {groups.map((group, index) => (
        <>
          {index > 0 ? <text fg={theme.border}>{"-".repeat(SIDEBAR_WIDTH)}</text> : null}
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
        />
      ),
    },
  }
}
