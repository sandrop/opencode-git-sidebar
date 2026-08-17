import type { TuiDispose, TuiPluginApi, TuiSlotPlugin } from "@opencode-ai/plugin/tui"
import { expect, it, vi } from "vitest"
import { createRefreshController, type RefreshController } from "../src/refresh.js"
import { activate } from "../src/tui.js"

it("activates the sidebar, palette refresh, and controller lifecycle", async () => {
  const slotPlugins: TuiSlotPlugin[] = []
  const commandLayers: Array<Parameters<TuiPluginApi["keymap"]["registerLayer"]>[0]> = []
  const disposals: TuiDispose[] = []
  const api = {
    state: {
      path: { worktree: "/repo/worktree", directory: "/repo/directory" },
      vcs: { branch: "feat/sidebar" },
    },
    slots: {
      register: vi.fn((plugin: TuiSlotPlugin) => {
        slotPlugins.push(plugin)
        return "git-sidebar"
      }),
    },
    keymap: {
      registerLayer: vi.fn((layer: (typeof commandLayers)[number]) => {
        commandLayers.push(layer)
        return vi.fn()
      }),
    },
    lifecycle: {
      onDispose: vi.fn((dispose: TuiDispose) => {
        disposals.push(dispose)
        return vi.fn()
      }),
    },
  } as unknown as TuiPluginApi
  const controller = {
    start: vi.fn(),
    refreshLocal: vi.fn(),
    refreshRemote: vi.fn(),
    refreshAll: vi.fn(),
    dispose: vi.fn(),
  } satisfies RefreshController
  const createController = vi.fn<typeof createRefreshController>(() => controller)
  const deps = {
    runner: vi.fn(),
    collectLocal: vi.fn(),
    collectRemote: vi.fn(),
    createRefreshController: createController,
  }

  await activate(api, { localRefreshMs: 5_000 }, deps)

  expect(api.slots.register).toHaveBeenCalledTimes(1)
  expect(slotPlugins).toHaveLength(1)
  expect(api.keymap.registerLayer).toHaveBeenCalledWith({
    commands: [
      expect.objectContaining({
        name: "git-sidebar.refresh",
        title: "Git Sidebar: Refresh",
        category: "Plugin",
        namespace: "palette",
      }),
    ],
  })
  expect(deps.createRefreshController).toHaveBeenCalledWith(
    expect.objectContaining({
      options: { localRefreshMs: 5_000, remoteRefreshMs: 30_000 },
    }),
  )
  const controllerInput = deps.createRefreshController.mock.calls[0][0]
  expect(controllerInput.context()).toEqual({
    cwd: "/repo/worktree",
    branch: "feat/sidebar",
  })
  expect(controller.start).toHaveBeenCalledTimes(1)

  await commandLayers[0].commands?.[0].run({} as never)
  expect(controller.refreshAll).toHaveBeenCalledTimes(1)

  await disposals[0]()
  expect(controller.dispose).toHaveBeenCalledTimes(1)
})
