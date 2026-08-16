import { describe, expect, it, vi } from "vitest"
import { collectGitState, parseGitStatus } from "../src/git.js"

describe("parseGitStatus", () => {
  it("counts staged, modified, and untracked entries", () => {
    const output = [
      "# branch.head feat/sidebar",
      "1 M. N... 100644 100644 100644 abc abc staged.ts",
      "1 .M N... 100644 100644 100644 abc abc modified.ts",
      "? untracked.ts",
    ].join("\n")

    expect(parseGitStatus(output)).toEqual({
      branch: "feat/sidebar",
      staged: 1,
      modified: 1,
      untracked: 1,
    })
  })

  it("maps a detached branch and clean tree", () => {
    expect(parseGitStatus("# branch.head (detached)\n")).toEqual({
      branch: "detached HEAD",
      staged: 0,
      modified: 0,
      untracked: 0,
    })
  })
})

it("collects status in the supplied worktree", async () => {
  const runner = vi.fn().mockResolvedValue({
    ok: true,
    stdout: "# branch.head feat/sidebar\n? new.ts\n",
    stderr: "",
  })

  await expect(collectGitState({ cwd: "/repo/sidebar", runner })).resolves.toEqual({
    repository: true,
    branch: "feat/sidebar",
    worktree: "sidebar",
    staged: 0,
    modified: 0,
    untracked: 1,
  })
  expect(runner).toHaveBeenCalledWith(
    "git",
    ["status", "--porcelain=v2", "--branch"],
    expect.objectContaining({ cwd: "/repo/sidebar" }),
  )
})
