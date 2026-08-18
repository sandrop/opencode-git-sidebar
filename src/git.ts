import { basename } from "node:path"
import { runCommand, type CommandResult, type CommandRunner } from "./command.js"

type GitStatus = {
  branch: string
  staged: number
  modified: number
  untracked: number
}

export type GitState =
  | { repository: false }
  | ({ repository: true; worktree: string } & GitStatus)

export class GitCollectionError extends Error {
  readonly reason: NonNullable<CommandResult["reason"]>

  constructor(reason: NonNullable<CommandResult["reason"]>, stderr: string) {
    super(stderr.trim() || `Git status failed: ${reason}`)
    this.name = "GitCollectionError"
    this.reason = reason
  }
}

export function parseGitStatus(output: string): GitStatus {
  let branch = ""
  let staged = 0
  let modified = 0
  let untracked = 0

  for (const line of output.split("\n")) {
    if (line.startsWith("# branch.head ")) {
      const head = line.slice("# branch.head ".length)
      branch = head === "(detached)" ? "detached HEAD" : head
      continue
    }

    if (line.startsWith("? ")) {
      untracked += 1
      continue
    }

    if (/^[12u] /.test(line)) {
      const status = line.slice(2, 4)
      if (status[0] !== ".") staged += 1
      if (status[1] !== ".") modified += 1
    }
  }

  return { branch, staged, modified, untracked }
}

export async function collectGitState(input: {
  cwd: string
  runner?: CommandRunner
  signal?: AbortSignal
}): Promise<GitState> {
  const runner = input.runner ?? runCommand
  const result = await runner(
    "git",
    ["status", "--porcelain=v2", "--branch", "--untracked-files=all"],
    {
      cwd: input.cwd,
      timeoutMs: 2_000,
      signal: input.signal,
      env: { ...process.env, LANG: "C", LC_ALL: "C" },
    },
  )

  if (!result.ok) {
    if (result.reason === "exit" && /not a git repository/i.test(result.stderr)) {
      return { repository: false }
    }
    throw new GitCollectionError(result.reason ?? "exit", result.stderr)
  }

  return {
    repository: true,
    worktree: basename(input.cwd),
    ...parseGitStatus(result.stdout),
  }
}
