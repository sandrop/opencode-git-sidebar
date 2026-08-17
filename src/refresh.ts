import type { GitState } from "./git.js"
import type { PullRequestState } from "./github.js"
import type { ResolvedOptions } from "./tui.js"

type RefreshValue<T> = {
  value: T | null
  stale: boolean
}

export type RefreshSnapshot = {
  local: RefreshValue<GitState>
  remote: RefreshValue<PullRequestState>
}

export type RefreshController = {
  start(): void
  refreshLocal(): Promise<void>
  refreshRemote(): Promise<void>
  refreshAll(): Promise<void>
  dispose(): void
}

type RefreshContext = {
  cwd: string
  branch: string
}

export function createRefreshController(deps: {
  options: ResolvedOptions
  context: () => RefreshContext
  collectLocal: (input: { cwd: string; signal: AbortSignal }) => Promise<GitState>
  collectRemote: (input: RefreshContext & { signal: AbortSignal }) => Promise<PullRequestState>
  onChange: (snapshot: RefreshSnapshot) => void
}): RefreshController {
  const abortController = new AbortController()
  let localTimer: ReturnType<typeof setInterval> | undefined
  let remoteTimer: ReturnType<typeof setInterval> | undefined
  let localInFlight: Promise<void> | undefined
  let remoteInFlight: Promise<void> | undefined
  let remoteInFlightKey: string | undefined
  let lastContextKey: string | undefined
  let disposed = false
  let snapshot: RefreshSnapshot = {
    local: { value: null, stale: false },
    remote: { value: null, stale: false },
  }

  const notify = () => {
    if (!disposed) deps.onChange(snapshot)
  }

  const keyFor = ({ cwd, branch }: RefreshContext) => `${cwd}\0${branch}`

  const refreshLocal = () => {
    if (localInFlight) return localInFlight
    const operation = (async () => {
      const { cwd, branch } = deps.context()
      const contextKey = keyFor({ cwd, branch })
      const contextChanged = lastContextKey !== undefined && contextKey !== lastContextKey
      lastContextKey = contextKey
      if (contextChanged) {
        snapshot = {
          local: { value: null, stale: false },
          remote: { value: null, stale: false },
        }
        notify()
      }
      try {
        const value = await deps.collectLocal({ cwd, signal: abortController.signal })
        snapshot = { ...snapshot, local: { value, stale: false } }
      } catch {
        snapshot = { ...snapshot, local: { ...snapshot.local, stale: true } }
      }
      notify()
      if (contextChanged) await refreshRemote()
    })().finally(() => {
      if (localInFlight === operation) localInFlight = undefined
    })
    localInFlight = operation
    return operation
  }

  const refreshRemote: RefreshController["refreshRemote"] = () => {
    const context = deps.context()
    const contextKey = keyFor(context)
    if (remoteInFlight) {
      if (remoteInFlightKey === contextKey) return remoteInFlight
      return remoteInFlight.then(() => (disposed ? undefined : refreshRemote()))
    }
    const operation = (async () => {
      try {
        const value = await deps.collectRemote({
          ...context,
          signal: abortController.signal,
        })
        if (keyFor(deps.context()) !== contextKey) return
        snapshot = { ...snapshot, remote: { value, stale: false } }
      } catch {
        if (keyFor(deps.context()) !== contextKey) return
        snapshot = { ...snapshot, remote: { ...snapshot.remote, stale: true } }
      }
      notify()
    })().finally(() => {
      if (remoteInFlight === operation) {
        remoteInFlight = undefined
        remoteInFlightKey = undefined
      }
    })
    remoteInFlight = operation
    remoteInFlightKey = contextKey
    return operation
  }

  const refreshAll = async () => {
    await Promise.all([refreshLocal(), refreshRemote()])
  }

  return {
    start() {
      if (localTimer || remoteTimer) return
      void refreshAll()
      localTimer = setInterval(() => void refreshLocal(), deps.options.localRefreshMs)
      remoteTimer = setInterval(() => void refreshRemote(), deps.options.remoteRefreshMs)
    },
    refreshLocal,
    refreshRemote,
    refreshAll,
    dispose() {
      disposed = true
      if (localTimer) clearInterval(localTimer)
      if (remoteTimer) clearInterval(remoteTimer)
      localTimer = undefined
      remoteTimer = undefined
      abortController.abort()
    },
  }
}
