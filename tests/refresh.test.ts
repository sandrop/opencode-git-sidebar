import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { createRefreshController } from "../src/refresh.js"

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it("runs both collectors immediately and on independent intervals", async () => {
  const local = vi.fn().mockResolvedValue({
    repository: true,
    branch: "feat/sidebar",
    worktreePath: "/repo",
    workingTreePath: "/repo",
    staged: 0,
    modified: 0,
    untracked: 0,
  })
  const remote = vi.fn().mockResolvedValue({ kind: "none" })
  const controller = createRefreshController({
    options: { localRefreshMs: 10_000, remoteRefreshMs: 30_000 },
    context: () => ({
      worktreePath: "/repo",
      workingTreePath: "/repo",
      branch: "feat/sidebar",
    }),
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

it("reuses in-flight work instead of overlapping collectors", async () => {
  const localState = {
    repository: true as const,
    branch: "feat/sidebar",
    worktreePath: "/repo",
    workingTreePath: "/repo",
    staged: 0,
    modified: 0,
    untracked: 0,
  }
  const remoteState = { kind: "none" as const }
  let resolveLocal!: (value: typeof localState) => void
  let resolveRemote!: (value: typeof remoteState) => void
  const localResult = new Promise<typeof localState>((resolve) => (resolveLocal = resolve))
  const remoteResult = new Promise<typeof remoteState>((resolve) => (resolveRemote = resolve))
  const local = vi.fn(() => localResult)
  const remote = vi.fn(() => remoteResult)
  const controller = createRefreshController({
    options: { localRefreshMs: 10_000, remoteRefreshMs: 30_000 },
    context: () => ({
      worktreePath: "/repo",
      workingTreePath: "/repo",
      branch: "feat/sidebar",
    }),
    collectLocal: local,
    collectRemote: remote,
    onChange: vi.fn(),
  })

  const first = controller.refreshAll()
  const overlapping = controller.refreshAll()

  expect(local).toHaveBeenCalledTimes(1)
  expect(remote).toHaveBeenCalledTimes(1)

  resolveLocal(localState)
  resolveRemote(remoteState)
  await Promise.all([first, overlapping])
  await controller.refreshAll()

  expect(local).toHaveBeenCalledTimes(2)
  expect(remote).toHaveBeenCalledTimes(2)
})

it("retains the last successful value as stale when one collector fails", async () => {
  const localState = {
    repository: true as const,
    branch: "feat/sidebar",
    worktreePath: "/repo",
    workingTreePath: "/repo",
    staged: 1,
    modified: 2,
    untracked: 3,
  }
  const remoteState = { kind: "none" as const }
  const local = vi
    .fn()
    .mockResolvedValueOnce(localState)
    .mockRejectedValueOnce(new Error("git timed out"))
  const onChange = vi.fn()
  const controller = createRefreshController({
    options: { localRefreshMs: 10_000, remoteRefreshMs: 30_000 },
    context: () => ({
      worktreePath: "/repo",
      workingTreePath: "/repo",
      branch: "feat/sidebar",
    }),
    collectLocal: local,
    collectRemote: vi.fn().mockResolvedValue(remoteState),
    onChange,
  })

  await controller.refreshAll()
  await controller.refreshLocal()

  expect(onChange).toHaveBeenLastCalledWith({
    local: { value: localState, stale: true, status: "ready" },
    remote: { value: remoteState, stale: false, status: "ready" },
  })
})

it("marks an initial collection failure as an error rather than stale loading state", async () => {
  const onChange = vi.fn()
  const controller = createRefreshController({
    options: { localRefreshMs: 10_000, remoteRefreshMs: 30_000 },
    context: () => ({
      worktreePath: "/repo",
      workingTreePath: "/repo",
      branch: "feat/sidebar",
    }),
    collectLocal: vi.fn().mockRejectedValue(new Error("git timed out")),
    collectRemote: vi.fn().mockRejectedValue(new Error("gh timed out")),
    onChange,
  })

  await controller.refreshAll()

  expect(onChange).toHaveBeenLastCalledWith({
    local: { value: null, stale: false, status: "error" },
    remote: { value: null, stale: false, status: "error" },
  })
})

it("uses the successful local Git branch for remote collection when host state lags", async () => {
  const localState = {
    repository: true as const,
    branch: "branch-b",
    worktreePath: "/repo",
    workingTreePath: "/repo",
    staged: 0,
    modified: 0,
    untracked: 0,
  }
  const pullRequests = {
    "branch-a": {
      kind: "ready" as const,
      number: 1,
      state: "OPEN" as const,
      checks: { total: 1, passing: 1, pending: 0, failing: 0 },
    },
    "branch-b": {
      kind: "ready" as const,
      number: 2,
      state: "OPEN" as const,
      checks: { total: 1, passing: 1, pending: 0, failing: 0 },
    },
  }
  const onChange = vi.fn()
  const remote = vi.fn(({ branch }: { branch: string }) =>
    Promise.resolve(branch === "branch-b" ? pullRequests["branch-b"] : pullRequests["branch-a"]),
  )
  const controller = createRefreshController({
    options: { localRefreshMs: 10_000, remoteRefreshMs: 30_000 },
    context: () => ({
      worktreePath: "/repo",
      workingTreePath: "/repo",
      branch: "branch-a",
    }),
    collectLocal: vi.fn().mockResolvedValue(localState),
    collectRemote: remote,
    onChange,
  })

  await controller.refreshAll()

  expect(remote).toHaveBeenLastCalledWith(
    expect.objectContaining({
      worktreePath: "/repo",
      workingTreePath: "/repo",
      branch: "branch-b",
    }),
  )
  expect(remote).toHaveBeenCalledTimes(2)
  expect(onChange).toHaveBeenLastCalledWith({
    local: { value: localState, stale: false, status: "ready" },
    remote: { value: pullRequests["branch-b"], stale: false, status: "ready" },
  })
  expect(
    onChange.mock.calls.some(
      ([snapshot]) =>
        snapshot.local.value?.repository &&
        snapshot.local.value.branch === "branch-b" &&
        snapshot.remote.value?.kind === "ready" &&
        snapshot.remote.value.number === 1,
    ),
  ).toBe(false)
})

it("invalidates old state and refreshes both sources when context changes", async () => {
  const initialLocal = {
    repository: true as const,
    branch: "feat/sidebar",
    worktreePath: "/repo",
    workingTreePath: "/repo",
    staged: 0,
    modified: 0,
    untracked: 0,
  }
  const changedLocal = {
    repository: true as const,
    branch: "fix/sidebar",
    worktreePath: "/other",
    workingTreePath: "/other",
    staged: 1,
    modified: 0,
    untracked: 0,
  }
  let resolveChangedLocal!: (value: typeof changedLocal) => void
  const changedLocalResult = new Promise<typeof changedLocal>(
    (resolve) => (resolveChangedLocal = resolve),
  )
  const local = vi
    .fn()
    .mockResolvedValueOnce(initialLocal)
    .mockImplementationOnce(() => changedLocalResult)
  const remote = vi.fn().mockResolvedValue({ kind: "none" as const })
  const onChange = vi.fn()
  let context = {
    worktreePath: "/repo",
    workingTreePath: "/repo",
    branch: "feat/sidebar",
  }
  const controller = createRefreshController({
    options: { localRefreshMs: 10_000, remoteRefreshMs: 30_000 },
    context: () => context,
    collectLocal: local,
    collectRemote: remote,
    onChange,
  })

  controller.start()
  await vi.runAllTicks()
  context = {
    worktreePath: "/other",
    workingTreePath: "/other",
    branch: "fix/sidebar",
  }
  await vi.advanceTimersByTimeAsync(10_000)

  expect(onChange).toHaveBeenLastCalledWith({
    local: { value: null, stale: false, status: "loading" },
    remote: { value: null, stale: false, status: "loading" },
  })
  expect(remote).toHaveBeenCalledTimes(1)

  resolveChangedLocal(changedLocal)
  await vi.runAllTicks()

  expect(local).toHaveBeenLastCalledWith(
    expect.objectContaining({ worktreePath: "/other", workingTreePath: "/other" }),
  )
  expect(remote).toHaveBeenLastCalledWith(
    expect.objectContaining({
      worktreePath: "/other",
      workingTreePath: "/other",
      branch: "fix/sidebar",
    }),
  )
  expect(local).toHaveBeenCalledTimes(2)
  expect(remote).toHaveBeenCalledTimes(2)
})

it("invalidates old state when only the working-tree path changes", async () => {
  const initialLocal = {
    repository: true as const,
    branch: "feat/sidebar",
    worktreePath: "/repo",
    workingTreePath: "/repo/packages/app",
    staged: 0,
    modified: 0,
    untracked: 0,
  }
  const changedLocal = {
    ...initialLocal,
    workingTreePath: "/repo/packages/docs",
  }
  let resolveChangedLocal!: (value: typeof changedLocal) => void
  const changedLocalResult = new Promise<typeof changedLocal>(
    (resolve) => (resolveChangedLocal = resolve),
  )
  const local = vi
    .fn()
    .mockResolvedValueOnce(initialLocal)
    .mockImplementationOnce(() => changedLocalResult)
  const remote = vi.fn().mockResolvedValue({ kind: "none" as const })
  const onChange = vi.fn()
  let context = {
    worktreePath: "/repo",
    workingTreePath: "/repo/packages/app",
    branch: "feat/sidebar",
  }
  const controller = createRefreshController({
    options: { localRefreshMs: 10_000, remoteRefreshMs: 30_000 },
    context: () => context,
    collectLocal: local,
    collectRemote: remote,
    onChange,
  })

  controller.start()
  await vi.runAllTicks()
  context = { ...context, workingTreePath: "/repo/packages/docs" }
  await vi.advanceTimersByTimeAsync(10_000)

  expect(onChange).toHaveBeenLastCalledWith({
    local: { value: null, stale: false, status: "loading" },
    remote: { value: null, stale: false, status: "loading" },
  })
  expect(remote).toHaveBeenCalledTimes(1)

  resolveChangedLocal(changedLocal)
  await vi.runAllTicks()

  expect(local).toHaveBeenLastCalledWith(
    expect.objectContaining({
      worktreePath: "/repo",
      workingTreePath: "/repo/packages/docs",
    }),
  )
  expect(remote).toHaveBeenLastCalledWith(
    expect.objectContaining({
      worktreePath: "/repo",
      workingTreePath: "/repo/packages/docs",
      branch: "feat/sidebar",
    }),
  )
  expect(local).toHaveBeenCalledTimes(2)
  expect(remote).toHaveBeenCalledTimes(2)
})

it("waits for an old remote request before collecting the changed context", async () => {
  const oldRemote = {
    kind: "ready" as const,
    number: 1,
    state: "OPEN" as const,
    checks: { total: 1, passing: 1, pending: 0, failing: 0 },
  }
  const newRemote = { kind: "none" as const }
  let resolveOldRemote!: (value: typeof oldRemote) => void
  const oldRemoteResult = new Promise<typeof oldRemote>(
    (resolve) => (resolveOldRemote = resolve),
  )
  const local = vi
    .fn()
    .mockResolvedValueOnce({
      repository: true as const,
      branch: "feat/sidebar",
      worktreePath: "/repo",
      workingTreePath: "/repo",
      staged: 0,
      modified: 0,
      untracked: 0,
    })
    .mockResolvedValueOnce({
      repository: true as const,
      branch: "fix/sidebar",
      worktreePath: "/other",
      workingTreePath: "/other",
      staged: 0,
      modified: 0,
      untracked: 0,
    })
  const remote = vi
    .fn()
    .mockImplementationOnce(() => oldRemoteResult)
    .mockResolvedValueOnce(newRemote)
  const onChange = vi.fn()
  let context = {
    worktreePath: "/repo",
    workingTreePath: "/repo",
    branch: "feat/sidebar",
  }
  const controller = createRefreshController({
    options: { localRefreshMs: 10_000, remoteRefreshMs: 30_000 },
    context: () => context,
    collectLocal: local,
    collectRemote: remote,
    onChange,
  })

  await controller.refreshLocal()
  void controller.refreshRemote()
  context = {
    worktreePath: "/other",
    workingTreePath: "/other",
    branch: "fix/sidebar",
  }
  const changedRefresh = controller.refreshLocal()

  expect(remote).toHaveBeenCalledTimes(1)

  resolveOldRemote(oldRemote)
  await changedRefresh

  expect(remote).toHaveBeenCalledTimes(2)
  expect(remote).toHaveBeenLastCalledWith(
    expect.objectContaining({
      worktreePath: "/other",
      workingTreePath: "/other",
      branch: "fix/sidebar",
    }),
  )
  expect(
    onChange.mock.calls.some(
      ([snapshot]) => snapshot.remote.value?.kind === "ready" && snapshot.remote.value.number === 1,
    ),
  ).toBe(false)
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ remote: { value: newRemote, stale: false, status: "ready" } }),
  )
})

it("queues changed-context local work and suppresses the old local result", async () => {
  const oldLocal = {
    repository: true as const,
    branch: "feat/sidebar",
    worktreePath: "/repo",
    workingTreePath: "/repo",
    staged: 0,
    modified: 0,
    untracked: 0,
  }
  const newLocal = {
    repository: true as const,
    branch: "fix/sidebar",
    worktreePath: "/other",
    workingTreePath: "/other",
    staged: 1,
    modified: 0,
    untracked: 0,
  }
  let resolveOldLocal!: (value: typeof oldLocal) => void
  const oldLocalResult = new Promise<typeof oldLocal>(
    (resolve) => (resolveOldLocal = resolve),
  )
  const local = vi
    .fn()
    .mockImplementationOnce(() => oldLocalResult)
    .mockResolvedValueOnce(newLocal)
  const onChange = vi.fn()
  const remote = vi.fn().mockResolvedValue({ kind: "none" as const })
  let context = {
    worktreePath: "/repo",
    workingTreePath: "/repo",
    branch: "feat/sidebar",
  }
  const controller = createRefreshController({
    options: { localRefreshMs: 10_000, remoteRefreshMs: 30_000 },
    context: () => context,
    collectLocal: local,
    collectRemote: remote,
    onChange,
  })

  void controller.refreshLocal()
  context = {
    worktreePath: "/other",
    workingTreePath: "/other",
    branch: "fix/sidebar",
  }
  const changedRefresh = controller.refreshLocal()

  expect(local).toHaveBeenCalledTimes(1)

  resolveOldLocal(oldLocal)
  await changedRefresh

  expect(local).toHaveBeenCalledTimes(2)
  expect(local).toHaveBeenLastCalledWith(
    expect.objectContaining({ worktreePath: "/other", workingTreePath: "/other" }),
  )
  expect(
    onChange.mock.calls.some(
      ([snapshot]) => snapshot.local.value?.repository && snapshot.local.value.branch === "feat/sidebar",
    ),
  ).toBe(false)
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ local: { value: newLocal, stale: false, status: "ready" } }),
  )
  expect(remote).toHaveBeenCalledTimes(1)
})

it("refreshes both values when remote observes a changed context first", async () => {
  const initialLocal = {
    repository: true as const,
    branch: "feat/sidebar",
    worktreePath: "/repo",
    workingTreePath: "/repo",
    staged: 0,
    modified: 0,
    untracked: 0,
  }
  const changedLocal = {
    ...initialLocal,
    branch: "fix/sidebar",
    worktreePath: "/other",
    workingTreePath: "/other",
  }
  const newRemote = { kind: "none" as const }
  let resolveNewRemote!: (value: typeof newRemote) => void
  const newRemoteResult = new Promise<typeof newRemote>(
    (resolve) => (resolveNewRemote = resolve),
  )
  const remote = vi
    .fn()
    .mockResolvedValueOnce({
      kind: "ready" as const,
      number: 1,
      state: "OPEN" as const,
      checks: { total: 1, passing: 1, pending: 0, failing: 0 },
    })
    .mockImplementationOnce(() => newRemoteResult)
  const onChange = vi.fn()
  let context = {
    worktreePath: "/repo",
    workingTreePath: "/repo",
    branch: "feat/sidebar",
  }
  const local = vi.fn().mockResolvedValueOnce(initialLocal).mockResolvedValueOnce(changedLocal)
  const controller = createRefreshController({
    options: { localRefreshMs: 10_000, remoteRefreshMs: 30_000 },
    context: () => context,
    collectLocal: local,
    collectRemote: remote,
    onChange,
  })

  await controller.refreshAll()
  onChange.mockClear()
  context = {
    worktreePath: "/other",
    workingTreePath: "/other",
    branch: "fix/sidebar",
  }
  const changedRefresh = controller.refreshRemote()

  expect(onChange).toHaveBeenLastCalledWith({
    local: { value: null, stale: false, status: "loading" },
    remote: { value: null, stale: false, status: "loading" },
  })

  resolveNewRemote(newRemote)
  await changedRefresh

  expect(onChange).toHaveBeenLastCalledWith({
    local: { value: changedLocal, stale: false, status: "ready" },
    remote: { value: newRemote, stale: false, status: "ready" },
  })
  expect(local).toHaveBeenCalledTimes(2)
  expect(remote).toHaveBeenCalledTimes(2)
})

it("aborts active work and prevents timer or callback activity after disposal", async () => {
  const localState = {
    repository: true as const,
    branch: "feat/sidebar",
    worktreePath: "/repo",
    workingTreePath: "/repo",
    staged: 0,
    modified: 0,
    untracked: 0,
  }
  const remoteState = { kind: "none" as const }
  let resolveLocal!: (value: typeof localState) => void
  let resolveRemote!: (value: typeof remoteState) => void
  let localSignal: AbortSignal | undefined
  let remoteSignal: AbortSignal | undefined
  const local = vi.fn(({ signal }: { signal: AbortSignal }) => {
    localSignal = signal
    return new Promise<typeof localState>((resolve) => (resolveLocal = resolve))
  })
  const remote = vi.fn(({ signal }: { signal: AbortSignal }) => {
    remoteSignal = signal
    return new Promise<typeof remoteState>((resolve) => (resolveRemote = resolve))
  })
  const onChange = vi.fn()
  const controller = createRefreshController({
    options: { localRefreshMs: 10_000, remoteRefreshMs: 30_000 },
    context: () => ({
      worktreePath: "/repo",
      workingTreePath: "/repo",
      branch: "feat/sidebar",
    }),
    collectLocal: local,
    collectRemote: remote,
    onChange,
  })

  controller.start()
  controller.dispose()

  expect(localSignal?.aborted).toBe(true)
  expect(remoteSignal?.aborted).toBe(true)

  resolveLocal(localState)
  resolveRemote(remoteState)
  await vi.runAllTicks()
  await vi.advanceTimersByTimeAsync(60_000)

  expect(local).toHaveBeenCalledTimes(1)
  expect(remote).toHaveBeenCalledTimes(1)
  expect(onChange).not.toHaveBeenCalled()
})

it("makes start and source refreshes no-ops after disposal", async () => {
  const context = vi.fn(() => ({
    worktreePath: "/repo",
    workingTreePath: "/repo",
    branch: "feat/sidebar",
  }))
  const local = vi.fn().mockResolvedValue({ repository: false as const })
  const remote = vi.fn().mockResolvedValue({ kind: "none" as const })
  const onChange = vi.fn()
  const controller = createRefreshController({
    options: { localRefreshMs: 10_000, remoteRefreshMs: 30_000 },
    context,
    collectLocal: local,
    collectRemote: remote,
    onChange,
  })

  controller.dispose()
  await controller.refreshLocal()
  await controller.refreshRemote()
  controller.start()
  await vi.advanceTimersByTimeAsync(60_000)

  expect(context).not.toHaveBeenCalled()
  expect(local).not.toHaveBeenCalled()
  expect(remote).not.toHaveBeenCalled()
  expect(onChange).not.toHaveBeenCalled()
})
