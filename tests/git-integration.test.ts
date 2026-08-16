import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { expect, it } from "vitest"
import { collectGitState } from "../src/git.js"

it("collects staged, modified, and untracked files from a real repository", async () => {
  const repository = mkdtempSync(join(tmpdir(), "opencode-git-sidebar-"))
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repository })

  git("init", "-b", "task-2")
  git("config", "user.name", "OpenCode Git Sidebar Test")
  git("config", "user.email", "test@opencode-git-sidebar.invalid")
  writeFileSync(join(repository, "committed.ts"), "export const committed = true\n")
  git("add", "committed.ts")
  git("commit", "-m", "test fixture")

  writeFileSync(join(repository, "staged.ts"), "export const staged = true\n")
  git("add", "staged.ts")
  writeFileSync(join(repository, "committed.ts"), "export const committed = false\n")
  writeFileSync(join(repository, "untracked.ts"), "export const untracked = true\n")

  await expect(collectGitState({ cwd: repository })).resolves.toEqual({
    repository: true,
    branch: "task-2",
    worktree: basename(repository),
    staged: 1,
    modified: 1,
    untracked: 1,
  })
})
