import type { TuiPluginApi, TuiSlotContext } from "@opencode-ai/plugin/tui"
import stringWidth from "string-width"
import { expect, it, vi } from "vitest"
import { buildSidebarGroups, GitSidebar, sidebarSlot } from "../src/sidebar.js"

vi.mock("@opentui/solid/jsx-runtime", () => {
  const Fragment = (props: { children?: unknown }) => props.children ?? null
  const jsx = (type: string | ((props: Record<string, unknown>) => unknown), props: Record<string, unknown>) =>
    typeof type === "function" ? type(props) : { type, props }
  return { Fragment, jsx, jsxs: jsx }
})

vi.mock("@opentui/solid/jsx-dev-runtime", () => {
  const Fragment = (props: { children?: unknown }) => props.children ?? null
  const jsxDEV = (
    type: string | ((props: Record<string, unknown>) => unknown),
    props: Record<string, unknown>,
  ) => (typeof type === "function" ? type(props) : { type, props })
  return { Fragment, jsxDEV }
})

type TestElement = {
  type: string
  props: Record<string, unknown>
}

const elements = (value: unknown): TestElement[] =>
  Array.isArray(value)
    ? value.flatMap(elements)
    : value && typeof value === "object" && "type" in value
      ? [value as TestElement]
      : []

const textValue = (value: unknown): string =>
  Array.isArray(value)
    ? value.map(textValue).join("")
    : value && typeof value === "object" && "props" in value
      ? textValue((value as TestElement).props.children)
      : String(value ?? "")

const textOf = (element: TestElement) => textValue(element.props.children)

const snapshot = (input?: {
  branch?: string
  worktree?: string
  staged?: number
  modified?: number
  untracked?: number
  checks?: { total: number; passing: number; pending: number; failing: number }
}) => ({
  local: {
    value: {
      repository: true as const,
      branch: input?.branch ?? "feat/sidebar",
      worktree: input?.worktree ?? "cobtask",
      staged: input?.staged ?? 0,
      modified: input?.modified ?? 0,
      untracked: input?.untracked ?? 0,
    },
    stale: false,
    status: "ready" as const,
  },
  remote: {
    value: {
      kind: "ready" as const,
      number: 142,
      state: "OPEN" as const,
      checks: input?.checks ?? { total: 8, passing: 8, pending: 0, failing: 0 },
    },
    stale: false,
    status: "ready" as const,
  },
})

const colors = {
  text: "#f1f2f3",
  textMuted: "#717273",
  primary: "#8182f3",
  success: "#218243",
  warning: "#f1a223",
  error: "#e14243",
  border: "#414243",
}

const slotContext = {
  theme: { current: colors },
} as unknown as TuiSlotContext

it("builds the approved four vertical groups", () => {
  const groups = buildSidebarGroups(
    {
      local: {
        value: {
          repository: true,
          branch: "feat/sidebar",
          worktree: "cobtask",
          staged: 2,
          modified: 3,
          untracked: 1,
        },
        stale: false,
        status: "ready",
      },
      remote: {
        value: {
          kind: "ready",
          number: 142,
          state: "OPEN",
          checks: { total: 8, passing: 8, pending: 0, failing: 0 },
        },
        stale: false,
        status: "ready",
      },
    },
    28,
  )

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
  expect(
    buildSidebarGroups(
      {
        local: { value: { repository: false }, stale: false, status: "ready" },
        remote: { value: null, stale: false, status: "loading" },
      },
      28,
    ),
  ).toEqual([])
})

it("renders a concise muted state after the initial local collection fails", () => {
  expect(
    buildSidebarGroups(
      {
        local: { value: null, stale: false, status: "error" },
        remote: { value: null, stale: false, status: "loading" },
      },
      28,
    ),
  ).toEqual([
    {
      header: "STATUS",
      fact: "Git status unavailable",
      tone: "muted",
      stale: false,
    },
  ])
})

it.each([
  [{ value: null, stale: false, status: "loading" as const }, "loading"],
  [{ value: null, stale: false, status: "error" as const }, "refresh failed"],
  [
    {
      value: { kind: "unavailable" as const, message: "GitHub unavailable" as const },
      stale: false,
      status: "ready" as const,
    },
    "GitHub unavailable",
  ],
  [
    { value: { kind: "none" as const }, stale: false, status: "ready" as const },
    "no pull request",
  ],
])("distinguishes Pull Request state %#", (remote, expected) => {
  const groups = buildSidebarGroups({ ...snapshot(), remote }, 28)

  expect(groups[3].fact).toBe(expected)
  expect(groups[3].tone).toBe("muted")
})

it("omits zero working-tree counts and renders clean when all counts are zero", () => {
  expect(buildSidebarGroups(snapshot(), 28)[2].fact).toBe("clean")
  expect(buildSidebarGroups(snapshot({ modified: 3 }), 28)[2].fact).toBe("3 modified")
})

it.each([
  [30, "2 staged | 3 mod | 1 untracked"],
  [24, "2 staged | 3 mod | 1 new"],
  [19, "2 S | 3 mod | 1 new"],
  [17, "2 S | 3 M | 1 new"],
  [15, "2 S | 3 M | 1 ?"],
])("shortens working-tree labels in order to fit %i columns", (width, expected) => {
  expect(buildSidebarGroups(snapshot({ staged: 2, modified: 3, untracked: 1 }), width)[2].fact).toBe(
    expected,
  )
})

it.each([
  [{ total: 8, passing: 6, pending: 1, failing: 1 }, "#142 OPEN | 1/8 failing"],
  [{ total: 8, passing: 6, pending: 2, failing: 0 }, "#142 OPEN | 2/8 pending"],
  [{ total: 8, passing: 8, pending: 0, failing: 0 }, "#142 OPEN | 8/8 passing"],
])("summarizes pull-request checks by priority", (checks, expected) => {
  expect(buildSidebarGroups(snapshot({ checks }), 28)[3].fact).toBe(expected)
})

it("shortens only a passing pull-request summary when required", () => {
  expect(buildSidebarGroups(snapshot(), 19)[3].fact).toBe("#142 OPEN | 8/8 ok")
})

it("fits CJK facts to 28 terminal cells", () => {
  const fact = buildSidebarGroups(snapshot({ branch: "界".repeat(20) }), 28)[0].fact

  expect(fact).toBe("界".repeat(14))
  expect(stringWidth(fact)).toBeLessThanOrEqual(28)
})

it("fits emoji facts without splitting graphemes", () => {
  const emoji = "👩‍💻"
  const fact = buildSidebarGroups(snapshot({ branch: emoji.repeat(20) }), 28)[0].fact

  expect(fact).toBe(emoji.repeat(14))
  expect(stringWidth(fact)).toBeLessThanOrEqual(28)
})

it("counts combining marks as zero terminal cells", () => {
  const branch = "e\u0301".repeat(28)
  const fact = buildSidebarGroups(snapshot({ branch }), 28)[0].fact

  expect(fact).toBe(branch)
  expect(stringWidth(fact)).toBe(28)
})

it("registers only the sidebar content slot at order 75", () => {
  const plugin = sidebarSlot({} as TuiPluginApi, snapshot, vi.fn())

  expect(plugin.order).toBe(75)
  expect(Object.keys(plugin.slots)).toEqual(["sidebar_content"])
})

it("reads the current snapshot while rendering and hides an empty group list", () => {
  const readSnapshot = vi.fn(() => ({
    local: { value: { repository: false as const }, stale: false, status: "ready" as const },
    remote: { value: null, stale: false, status: "loading" as const },
  }))
  const renderSidebar = sidebarSlot({} as TuiPluginApi, readSnapshot, vi.fn()).slots
    .sidebar_content
  const view = renderSidebar?.(slotContext, { session_id: "session" }) ?? null

  expect(readSnapshot).toHaveBeenCalledTimes(1)
  expect(view).toBeNull()
})

it("renders the approved vertical stack with themed rows and ASCII dividers", () => {
  const renderSidebar = sidebarSlot({} as TuiPluginApi, snapshot, vi.fn()).slots.sidebar_content
  const view = renderSidebar?.(slotContext, { session_id: "session" }) as unknown as TestElement
  const rows = elements(view.props.children)
  const header = rows[0]
  const headerItems = elements(header.props.children)

  expect(view).toMatchObject({ type: "box", props: { flexDirection: "column", width: 28 } })
  expect(header).toMatchObject({
    type: "box",
    props: { flexDirection: "row", justifyContent: "space-between", width: 28 },
  })
  expect(headerItems.map(textOf)).toEqual(["GIT", "refresh"])
  expect(rows.slice(1).map(textOf)).toEqual([
    "BRANCH",
    "feat/sidebar",
    "----------------------------",
    "WORKTREE",
    "cobtask",
    "----------------------------",
    "WORKING TREE",
    "clean",
    "----------------------------",
    "PULL REQUEST",
    "#142 OPEN | 8/8 passing",
  ])

  const row = (text: string) => rows.find((element) => textOf(element) === text)
  expect(row("BRANCH")?.props.fg).toBe(colors.textMuted)
  expect(row("feat/sidebar")?.props.fg).toBe(colors.primary)
  expect(row("clean")?.props.fg).toBe(colors.success)
  expect(row("----------------------------")?.props.fg).toBe(colors.border)
})

it("keeps the renderer and dividers fixed at 28 columns", () => {
  const props = {
    snapshot: snapshot(),
    onRefresh: vi.fn(),
    width: 10,
  }
  const view = GitSidebar(props) as unknown as TestElement
  const rows = elements(view.props.children)

  expect(view.props.width).toBe(28)
  expect(rows[0].props.width).toBe(28)
  expect(rows.filter((row) => textOf(row) === "----------------------------")).toHaveLength(3)
})

it("invokes refresh from the header control", () => {
  const onRefresh = vi.fn()
  const renderSidebar = sidebarSlot({} as TuiPluginApi, snapshot, onRefresh).slots.sidebar_content
  const view = renderSidebar?.(slotContext, { session_id: "session" }) as unknown as TestElement
  const header = elements(view.props.children)[0]
  const refresh = elements(header.props.children)[1]

  expect(refresh.type).toBe("box")
  ;(refresh.props.onMouseUp as () => void)()

  expect(onRefresh).toHaveBeenCalledTimes(1)
})
