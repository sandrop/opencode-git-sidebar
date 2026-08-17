import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { createRefreshController } from "../src/refresh.js"

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it("runs both collectors immediately and on independent intervals", async () => {
  const local = vi.fn().mockResolvedValue({
    repository: true,
    branch: "feat/sidebar",
    worktree: "repo",
    staged: 0,
    modified: 0,
    untracked: 0,
  })
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

it("reuses in-flight work instead of overlapping collectors", async () => {
  const localState = {
    repository: true as const,
    branch: "feat/sidebar",
    worktree: "repo",
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
    context: () => ({ cwd: "/repo", branch: "feat/sidebar" }),
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
    worktree: "repo",
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
    context: () => ({ cwd: "/repo", branch: "feat/sidebar" }),
    collectLocal: local,
    collectRemote: vi.fn().mockResolvedValue(remoteState),
    onChange,
  })

  await controller.refreshAll()
  await controller.refreshLocal()

  expect(onChange).toHaveBeenLastCalledWith({
    local: { value: localState, stale: true },
    remote: { value: remoteState, stale: false },
  })
})

it("invalidates old state and refreshes both sources when context changes", async () => {
  const initialLocal = {
    repository: true as const,
    branch: "feat/sidebar",
    worktree: "repo",
    staged: 0,
    modified: 0,
    untracked: 0,
  }
  const changedLocal = {
    repository: true as const,
    branch: "fix/sidebar",
    worktree: "other",
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
  let context = { cwd: "/repo", branch: "feat/sidebar" }
  const controller = createRefreshController({
    options: { localRefreshMs: 10_000, remoteRefreshMs: 30_000 },
    context: () => context,
    collectLocal: local,
    collectRemote: remote,
    onChange,
  })

  controller.start()
  await vi.runAllTicks()
  context = { cwd: "/other", branch: "fix/sidebar" }
  await vi.advanceTimersByTimeAsync(10_000)

  expect(onChange).toHaveBeenLastCalledWith({
    local: { value: null, stale: false },
    remote: { value: null, stale: false },
  })
  expect(remote).toHaveBeenCalledTimes(1)

  resolveChangedLocal(changedLocal)
  await vi.runAllTicks()

  expect(local).toHaveBeenLastCalledWith(
    expect.objectContaining({ cwd: "/other" }),
  )
  expect(remote).toHaveBeenLastCalledWith(
    expect.objectContaining({ cwd: "/other", branch: "fix/sidebar" }),
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
  const local = vi.fn().mockResolvedValue({
    repository: true as const,
    branch: "feat/sidebar",
    worktree: "repo",
    staged: 0,
    modified: 0,
    untracked: 0,
  })
  const remote = vi
    .fn()
    .mockImplementationOnce(() => oldRemoteResult)
    .mockResolvedValueOnce(newRemote)
  const onChange = vi.fn()
  let context = { cwd: "/repo", branch: "feat/sidebar" }
  const controller = createRefreshController({
    options: { localRefreshMs: 10_000, remoteRefreshMs: 30_000 },
    context: () => context,
    collectLocal: local,
    collectRemote: remote,
    onChange,
  })

  await controller.refreshLocal()
  void controller.refreshRemote()
  context = { cwd: "/other", branch: "fix/sidebar" }
  const changedRefresh = controller.refreshLocal()

  expect(remote).toHaveBeenCalledTimes(1)

  resolveOldRemote(oldRemote)
  await changedRefresh

  expect(remote).toHaveBeenCalledTimes(2)
  expect(remote).toHaveBeenLastCalledWith(
    expect.objectContaining({ cwd: "/other", branch: "fix/sidebar" }),
  )
  expect(
    onChange.mock.calls.some(
      ([snapshot]) => snapshot.remote.value?.kind === "ready" && snapshot.remote.value.number === 1,
    ),
  ).toBe(false)
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ remote: { value: newRemote, stale: false } }),
  )
})

it("aborts active work and prevents timer or callback activity after disposal", async () => {
  const localState = {
    repository: true as const,
    branch: "feat/sidebar",
    worktree: "repo",
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
    context: () => ({ cwd: "/repo", branch: "feat/sidebar" }),
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
