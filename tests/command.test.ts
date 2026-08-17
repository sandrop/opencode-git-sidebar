import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { runCommand } from "../src/command.js"

describe("runCommand", () => {
  it("classifies a missing executable", async () => {
    const result = await runCommand(join(tmpdir(), "missing-opencode-git-sidebar-command"), [], {
      cwd: tmpdir(),
      timeoutMs: 1_000,
    })

    expect(result).toMatchObject({ ok: false, reason: "missing", stdout: "", stderr: "" })
  })

  it("classifies a non-zero exit and preserves output", async () => {
    const result = await runCommand(
      process.execPath,
      ["-e", "process.stdout.write('output'); process.stderr.write('failure'); process.exit(7)"],
      { cwd: tmpdir(), timeoutMs: 1_000 },
    )

    expect(result).toEqual({
      ok: false,
      stdout: "output",
      stderr: "failure",
      reason: "exit",
    })
  })

  it("classifies a timed-out command", async () => {
    const result = await runCommand(process.execPath, ["-e", "setTimeout(() => {}, 10_000)"], {
      cwd: tmpdir(),
      timeoutMs: 50,
    })

    expect(result).toMatchObject({ ok: false, reason: "timeout" })
  })

  it("classifies an aborted command", async () => {
    const controller = new AbortController()
    const resultPromise = runCommand(process.execPath, ["-e", "setTimeout(() => {}, 10_000)"], {
      cwd: tmpdir(),
      timeoutMs: 1_000,
      signal: controller.signal,
    })

    controller.abort()

    await expect(resultPromise).resolves.toMatchObject({ ok: false, reason: "aborted" })
  })

  it("classifies a timeout as timeout when its signal was not aborted", async () => {
    const controller = new AbortController()
    const result = await runCommand(process.execPath, ["-e", "setTimeout(() => {}, 10_000)"], {
      cwd: tmpdir(),
      timeoutMs: 50,
      signal: controller.signal,
    })

    expect(result).toMatchObject({ ok: false, reason: "timeout" })
  })
})
