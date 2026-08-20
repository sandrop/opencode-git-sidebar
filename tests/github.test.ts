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

  it("classifies an expected status context as pending", () => {
    const output = JSON.stringify({
      number: 142,
      state: "OPEN",
      statusCheckRollup: [{ state: "EXPECTED" }],
    })

    expect(parsePullRequestJson(output)).toMatchObject({
      checks: { total: 1, passing: 0, pending: 1, failing: 0 },
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
  const trackedUpstream: CommandResult = {
    ok: true,
    stdout: "refs/heads/feat/sidebar\n",
    stderr: "",
  }

  const classificationCases = [
    [
      "gh missing",
      { ok: false, stdout: "", stderr: "", reason: "missing" },
      { kind: "unavailable", message: "GitHub unavailable" },
    ],
    [
      "not authenticated",
      { ok: false, stdout: "", stderr: "authenticate first", reason: "exit" },
      { kind: "unavailable", message: "GitHub unavailable" },
    ],
    [
      "unsupported remote",
      {
        ok: false,
        stdout: "",
        stderr: "none of the git remotes point to a known GitHub host",
        reason: "exit",
      },
      { kind: "unavailable", message: "GitHub unavailable" },
    ],
    [
      "no PR",
      {
        ok: false,
        stdout: "",
        stderr: "no pull requests found for branch",
        reason: "exit",
      },
      { kind: "none" },
    ],
  ] satisfies ReadonlyArray<
    readonly [string, CommandResult, PullRequestState]
  >

  it("returns no PR without running commands for a detached HEAD", async () => {
    const runner = vi.fn<CommandRunner>()

    await expect(
      collectPullRequest({ cwd: "/repo", branch: "detached HEAD", runner }),
    ).resolves.toEqual({ kind: "none" })
    expect(runner).not.toHaveBeenCalled()
  })

  it.each(classificationCases)("classifies %s", async (_name, result, expected) => {
    const runner = vi
      .fn<CommandRunner>()
      .mockResolvedValueOnce(trackedUpstream)
      .mockResolvedValueOnce(result)

    await expect(
      collectPullRequest({ cwd: "/repo", branch: "feat/sidebar", runner }),
    ).resolves.toEqual(expected)
  })

  it("resolves the PR from the tracked upstream for an isolated local branch", async () => {
    const runner = vi
      .fn<CommandRunner>()
      .mockResolvedValueOnce(trackedUpstream)
      .mockResolvedValueOnce({
        ok: true,
        stdout: JSON.stringify({ number: 266, state: "OPEN", statusCheckRollup: [] }),
        stderr: "",
      })

    await expect(
      collectPullRequest({ cwd: "/repo/sidebar", branch: "worktree-feat+sidebar", runner }),
    ).resolves.toMatchObject({ kind: "ready", number: 266 })
    expect(runner).toHaveBeenNthCalledWith(
      1,
      "git",
      [
        "for-each-ref",
        "--format=%(upstream:remoteref)",
        "refs/heads/worktree-feat+sidebar",
      ],
      expect.objectContaining({ cwd: "/repo/sidebar", timeoutMs: 10_000 }),
    )
    expect(runner).toHaveBeenNthCalledWith(
      2,
      "gh",
      ["pr", "view", "feat/sidebar", "--json", "number,state,statusCheckRollup"],
      expect.objectContaining({ cwd: "/repo/sidebar", timeoutMs: 10_000 }),
    )
  })

  it("forces a C locale only for upstream resolution", async () => {
    const runner = vi
      .fn<CommandRunner>()
      .mockResolvedValueOnce(trackedUpstream)
      .mockResolvedValueOnce({
        ok: true,
        stdout: JSON.stringify({ number: 266, state: "OPEN", statusCheckRollup: [] }),
        stderr: "",
      })

    await collectPullRequest({ cwd: "/repo/sidebar", branch: "worktree-feat+sidebar", runner })

    expect(runner).toHaveBeenNthCalledWith(
      1,
      "git",
      [
        "for-each-ref",
        "--format=%(upstream:remoteref)",
        "refs/heads/worktree-feat+sidebar",
      ],
      expect.objectContaining({
        env: expect.objectContaining({ LANG: "C", LC_ALL: "C" }),
      }),
    )
    expect(runner.mock.calls[1]?.[2]).not.toHaveProperty("env")
  })

  it("falls back to the local branch when no upstream exists", async () => {
    const runner = vi
      .fn<CommandRunner>()
      .mockResolvedValueOnce({
        ok: true,
        stdout: "",
        stderr: "",
      })
      .mockResolvedValueOnce({
        ok: true,
        stdout: JSON.stringify({ number: 266, state: "OPEN", statusCheckRollup: [] }),
        stderr: "",
      })

    await collectPullRequest({ cwd: "/repo/sidebar", branch: "worktree-feat+sidebar", runner })

    expect(runner).toHaveBeenNthCalledWith(
      2,
      "gh",
      ["pr", "view", "worktree-feat+sidebar", "--json", "number,state,statusCheckRollup"],
      expect.objectContaining({ cwd: "/repo/sidebar", timeoutMs: 10_000 }),
    )
  })

  it("does not query the local branch when upstream resolution times out", async () => {
    const runner = vi
      .fn<CommandRunner>()
      .mockResolvedValueOnce({ ok: false, stdout: "", stderr: "", reason: "timeout" })
      .mockResolvedValueOnce({
        ok: true,
        stdout: JSON.stringify({ number: 266, state: "OPEN", statusCheckRollup: [] }),
        stderr: "",
      })

    await expect(
      collectPullRequest({ cwd: "/repo/sidebar", branch: "worktree-feat+sidebar", runner }),
    ).rejects.toThrow("Git upstream resolution failed: timeout")
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it("uses the branch from the tracked upstream remote ref", async () => {
    const runner = vi
      .fn<CommandRunner>()
      .mockResolvedValueOnce({
        ok: true,
        stdout: "refs/heads/feat/sidebar\n",
        stderr: "",
      })
      .mockResolvedValueOnce({
        ok: true,
        stdout: JSON.stringify({ number: 266, state: "OPEN", statusCheckRollup: [] }),
        stderr: "",
      })

    await collectPullRequest({ cwd: "/repo/sidebar", branch: "worktree-feat+sidebar", runner })

    expect(runner).toHaveBeenNthCalledWith(
      2,
      "gh",
      ["pr", "view", "feat/sidebar", "--json", "number,state,statusCheckRollup"],
      expect.objectContaining({ cwd: "/repo/sidebar", timeoutMs: 10_000 }),
    )
  })

  it("requests the remote ref so slash-containing remote names need no parsing", async () => {
    const runner = vi
      .fn<CommandRunner>()
      .mockResolvedValueOnce({
        ok: true,
        stdout: "refs/heads/feat/sidebar\n",
        stderr: "",
      })
      .mockResolvedValueOnce({
        ok: true,
        stdout: JSON.stringify({ number: 266, state: "OPEN", statusCheckRollup: [] }),
        stderr: "",
      })

    await collectPullRequest({
      cwd: "/repo/sidebar",
      branch: "worktree-feat+sidebar",
      runner,
    })

    expect(runner).toHaveBeenNthCalledWith(
      2,
      "gh",
      ["pr", "view", "feat/sidebar", "--json", "number,state,statusCheckRollup"],
      expect.objectContaining({ cwd: "/repo/sidebar", timeoutMs: 10_000 }),
    )
    expect(runner).toHaveBeenNthCalledWith(
      1,
      "git",
      [
        "for-each-ref",
        "--format=%(upstream:remoteref)",
        "refs/heads/worktree-feat+sidebar",
      ],
      expect.objectContaining({ cwd: "/repo/sidebar", timeoutMs: 10_000 }),
    )
  })

  it.each([
    [{ ok: false, stdout: "", stderr: "", reason: "timeout" }, "timeout"],
    [{ ok: false, stdout: "", stderr: "network failure", reason: "exit" }, "network failure"],
  ] satisfies ReadonlyArray<readonly [CommandResult, string]>)(
    "throws when collection fails with %s",
    async (result, message) => {
      const runner = vi
        .fn<CommandRunner>()
        .mockResolvedValueOnce(trackedUpstream)
        .mockResolvedValueOnce(result)

      await expect(
        collectPullRequest({ cwd: "/repo", branch: "feat/sidebar", runner }),
      ).rejects.toThrow(message)
    },
  )
})
