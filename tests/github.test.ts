import { describe, expect, it, vi } from "vitest"
import type { CommandResult, CommandRunner } from "../src/command.js"
import {
  collectPullRequest,
  parsePullRequestJson,
  type PullRequestState,
} from "../src/github.js"

describe("parsePullRequestJson", () => {
  it("summarizes passing and pending checks", () => {
    const output = JSON.stringify({
      number: 142,
      state: "OPEN",
      statusCheckRollup: [
        { status: "COMPLETED", conclusion: "SUCCESS" },
        { status: "IN_PROGRESS", conclusion: null },
      ],
    })

    expect(parsePullRequestJson(output)).toEqual({
      kind: "ready",
      number: 142,
      state: "OPEN",
      checks: { total: 2, passing: 1, pending: 1, failing: 0 },
    })
  })

  it("rejects malformed gh output", () => {
    expect(() => parsePullRequestJson("not-json")).toThrow("Invalid gh JSON")
  })

  it("classifies passing, pending, and failed checks", () => {
    const output = JSON.stringify({
      number: 142,
      state: "MERGED",
      statusCheckRollup: [
        { status: "COMPLETED", conclusion: "NEUTRAL" },
        { status: "COMPLETED", conclusion: "SKIPPED" },
        { status: "QUEUED", conclusion: null },
        { status: "EXPECTED", conclusion: null },
        { status: "PENDING", conclusion: null },
        { status: "COMPLETED", conclusion: "FAILURE" },
      ],
    })

    expect(parsePullRequestJson(output)).toMatchObject({
      checks: { total: 6, passing: 2, pending: 3, failing: 1 },
    })
  })

  it("classifies status context states", () => {
    const output = JSON.stringify({
      number: 142,
      state: "OPEN",
      statusCheckRollup: [
        { state: "SUCCESS" },
        { state: "PENDING" },
        { state: "FAILURE" },
        { state: "ERROR" },
      ],
    })

    expect(parsePullRequestJson(output)).toMatchObject({
      checks: { total: 4, passing: 1, pending: 1, failing: 2 },
    })
  })

  it("classifies requested and waiting check runs as pending", () => {
    const output = JSON.stringify({
      number: 142,
      state: "OPEN",
      statusCheckRollup: [
        { status: "REQUESTED", conclusion: null },
        { status: "WAITING", conclusion: null },
      ],
    })

    expect(parsePullRequestJson(output)).toMatchObject({
      checks: { total: 2, passing: 0, pending: 2, failing: 0 },
    })
  })

  it.each([
    { state: "UNKNOWN" },
    { state: 1 },
    { status: "COMPLETED" },
  ])("rejects an invalid check shape", (check) => {
    const output = JSON.stringify({
      number: 142,
      state: "OPEN",
      statusCheckRollup: [check],
    })

    expect(() => parsePullRequestJson(output)).toThrow("Invalid gh JSON")
  })

  it.each([
    { number: "142", state: "OPEN", statusCheckRollup: [] },
    { number: 0, state: "OPEN", statusCheckRollup: [] },
    { number: -1, state: "OPEN", statusCheckRollup: [] },
    { number: 1.5, state: "OPEN", statusCheckRollup: [] },
    { number: Number.MAX_SAFE_INTEGER + 1, state: "OPEN", statusCheckRollup: [] },
    { number: 142, state: "DRAFT", statusCheckRollup: [] },
    { number: 142, state: "OPEN", statusCheckRollup: null },
  ])("rejects an invalid pull request shape", (value) => {
    expect(() => parsePullRequestJson(JSON.stringify(value))).toThrow("Invalid gh JSON")
  })
})

describe("collectPullRequest", () => {
  const classificationCases = [
    ["gh missing", { ok: false, stdout: "", stderr: "", reason: "missing" }, "unavailable"],
    [
      "not authenticated",
      { ok: false, stdout: "", stderr: "authenticate first", reason: "exit" },
      "unavailable",
    ],
    [
      "unsupported remote",
      {
        ok: false,
        stdout: "",
        stderr: "none of the git remotes point to a known GitHub host",
        reason: "exit",
      },
      "unavailable",
    ],
    [
      "no PR",
      {
        ok: false,
        stdout: "",
        stderr: "no pull requests found for branch",
        reason: "exit",
      },
      "none",
    ],
  ] satisfies ReadonlyArray<
    readonly [string, CommandResult, PullRequestState["kind"]]
  >

  it.each(classificationCases)("classifies %s", async (_name, result, kind) => {
    const runner = vi.fn<CommandRunner>().mockResolvedValue(result)

    await expect(
      collectPullRequest({ cwd: "/repo", branch: "feat/sidebar", runner }),
    ).resolves.toMatchObject({ kind })
  })

  it("runs gh for the supplied branch and worktree", async () => {
    const runner = vi.fn<CommandRunner>().mockResolvedValue({
      ok: true,
      stdout: JSON.stringify({ number: 142, state: "OPEN", statusCheckRollup: [] }),
      stderr: "",
    })

    await expect(
      collectPullRequest({ cwd: "/repo/sidebar", branch: "feat/sidebar", runner }),
    ).resolves.toMatchObject({ kind: "ready", number: 142 })
    expect(runner).toHaveBeenCalledWith(
      "gh",
      ["pr", "view", "feat/sidebar", "--json", "number,state,statusCheckRollup"],
      expect.objectContaining({ cwd: "/repo/sidebar", timeoutMs: 10_000 }),
    )
  })

  it.each([
    [{ ok: false, stdout: "", stderr: "", reason: "timeout" }, "timeout"],
    [{ ok: false, stdout: "", stderr: "network failure", reason: "exit" }, "network failure"],
  ] satisfies ReadonlyArray<readonly [CommandResult, string]>)(
    "throws when collection fails with %s",
    async (result, message) => {
      const runner = vi.fn<CommandRunner>().mockResolvedValue(result)

      await expect(
        collectPullRequest({ cwd: "/repo", branch: "feat/sidebar", runner }),
      ).rejects.toThrow(message)
    },
  )
})
