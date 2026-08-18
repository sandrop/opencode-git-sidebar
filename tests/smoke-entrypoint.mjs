import plugin from "opencode-git-sidebar/tui"

function createSmokeApi(registered) {
  const commandLayers = []
  const disposals = []
  const lifecycle = new AbortController()
  const state = {
    path: {
      worktree: process.cwd(),
      directory: process.cwd(),
    },
    vcs: { branch: "smoke-entrypoint" },
  }

  return {
    state,
    slots: {
      register(slot) {
        registered.push(slot)
        return `smoke-slot-${registered.length}`
      },
    },
    keymap: {
      registerLayer(layer) {
        commandLayers.push(layer)
        return () => {
          const index = commandLayers.indexOf(layer)
          if (index >= 0) commandLayers.splice(index, 1)
        }
      },
    },
    lifecycle: {
      signal: lifecycle.signal,
      onDispose(dispose) {
        disposals.push(dispose)
        return () => {
          const index = disposals.indexOf(dispose)
          if (index >= 0) disposals.splice(index, 1)
        }
      },
    },
    async dispose() {
      lifecycle.abort()
      for (const dispose of disposals.splice(0).reverse()) await dispose()
    },
  }
}

const registered = []
const api = createSmokeApi(registered)
await plugin.tui(
  api,
  { localRefreshMs: 60_000, remoteRefreshMs: 60_000 },
  { state: "same" },
)

if (plugin.id !== "opencode-git-sidebar") process.exit(2)
if (registered.length !== 1) process.exit(3)
process.stdout.write(JSON.stringify({ plugin: plugin.id, sidebarSlots: registered.length }))
await api.dispose()
