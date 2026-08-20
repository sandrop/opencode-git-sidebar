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

  it("counts a renamed path once per index and worktree category", () => {
    const output =
      "2 RM N... 100644 100644 100644 abc def R100 renamed.ts\toriginal.ts\n"

    expect(parseGitStatus(output)).toEqual({
      branch: "",
      staged: 1,
      modified: 1,
      untracked: 0,
    })
  })

  it("counts an unmerged path once per index and worktree category", () => {
    const output =
      "u UU N... 100644 100644 100644 100644 abc def ghi conflicted.ts\n"

    expect(parseGitStatus(output)).toEqual({
      branch: "",
      staged: 1,
      modified: 1,
      untracked: 0,
    })
  })
})

it("retains matching absolute worktree and working-tree paths for a normal checkout", async () => {
  const runner = vi.fn().mockResolvedValue({
    ok: true,
    stdout: "# branch.head feat/sidebar\n? new.ts\n",
    stderr: "",
  })

  await expect(
    collectGitState({
      worktreePath: "/repo/sidebar",
      workingTreePath: "/repo/sidebar",
      runner,
    }),
  ).resolves.toEqual({
    repository: true,
    branch: "feat/sidebar",
    worktreePath: "/repo/sidebar",
    workingTreePath: "/repo/sidebar",
    staged: 0,
    modified: 0,
    untracked: 1,
  })
  expect(runner).toHaveBeenCalledWith(
    "git",
    ["status", "--porcelain=v2", "--branch", "--untracked-files=all"],
    expect.objectContaining({
      cwd: "/repo/sidebar",
      env: expect.objectContaining({ LANG: "C", LC_ALL: "C" }),
    }),
  )
})

it("retains distinct absolute worktree and working-tree paths for an isolated checkout", async () => {
  const runner = vi.fn().mockResolvedValue({
    ok: true,
    stdout: "# branch.head feat/sidebar\n",
    stderr: "",
  })

  await expect(
    collectGitState({
      worktreePath: "/repo/worktrees/sidebar",
      workingTreePath: "/repo/worktrees/sidebar/packages/plugin",
      runner,
    }),
  ).resolves.toEqual({
    repository: true,
    branch: "feat/sidebar",
    worktreePath: "/repo/worktrees/sidebar",
    workingTreePath: "/repo/worktrees/sidebar/packages/plugin",
    staged: 0,
    modified: 0,
    untracked: 0,
  })
})
