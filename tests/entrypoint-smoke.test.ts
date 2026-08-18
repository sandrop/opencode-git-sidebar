import { spawnSync } from "node:child_process"
import { expect, it } from "vitest"

it("loads the built TUI entrypoint and registers one sidebar in a fresh process", () => {
  const build = spawnSync("npm", ["run", "build"], {
    cwd: process.cwd(),
    encoding: "utf8",
  })
  expect(build.status, build.stderr).toBe(0)

  const smoke = spawnSync(process.execPath, ["tests/smoke-entrypoint.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  })

  expect(smoke.status, smoke.stderr).toBe(0)
  expect(smoke.stdout).toBe(
    JSON.stringify({ plugin: "opencode-git-sidebar", sidebarSlots: 1 }),
  )
})
