import { runCommand, type CommandRunner } from "./command.js"

export type CheckSummary = {
  total: number
  passing: number
  pending: number
  failing: number
}

export type PullRequestState =
  | {
      kind: "ready"
      number: number
      state: "OPEN" | "CLOSED" | "MERGED"
      checks: CheckSummary
    }
  | { kind: "none" }
  | { kind: "unavailable"; message: "GitHub unavailable" }

const pullRequestStates = new Set(["OPEN", "CLOSED", "MERGED"])
const passingConclusions = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"])
const pendingStatuses = new Set([
  "QUEUED",
  "EXPECTED",
  "PENDING",
  "IN_PROGRESS",
  "REQUESTED",
  "WAITING",
])
const statusContextStates = new Set(["SUCCESS", "PENDING", "FAILURE", "ERROR"])

function invalidGhJson(): never {
  throw new Error("Invalid gh JSON")
}

export function parsePullRequestJson(output: string): PullRequestState {
  let value: unknown
  try {
    value = JSON.parse(output)
  } catch {
    invalidGhJson()
  }

  if (
    typeof value !== "object" ||
    value === null ||
    !("number" in value) ||
    typeof value.number !== "number" ||
    !Number.isSafeInteger(value.number) ||
    value.number <= 0 ||
    !("state" in value) ||
    typeof value.state !== "string" ||
    !pullRequestStates.has(value.state) ||
    !("statusCheckRollup" in value) ||
    !Array.isArray(value.statusCheckRollup)
  ) {
    invalidGhJson()
  }

  const checks: CheckSummary = {
    total: value.statusCheckRollup.length,
    passing: 0,
    pending: 0,
    failing: 0,
  }

  for (const check of value.statusCheckRollup) {
    if (typeof check !== "object" || check === null) {
      invalidGhJson()
    }

    if ("state" in check) {
      if (typeof check.state !== "string" || !statusContextStates.has(check.state)) {
        invalidGhJson()
      }

      if (check.state === "SUCCESS") {
        checks.passing += 1
      } else if (check.state === "PENDING") {
        checks.pending += 1
      } else {
        checks.failing += 1
      }
      continue
    }

    if (
      !("status" in check) ||
      typeof check.status !== "string" ||
      !("conclusion" in check) ||
      (typeof check.conclusion !== "string" && check.conclusion !== null)
    ) {
      invalidGhJson()
    }

    if (pendingStatuses.has(check.status)) {
      checks.pending += 1
    } else if (check.status === "COMPLETED") {
      if (check.conclusion !== null && passingConclusions.has(check.conclusion)) {
        checks.passing += 1
      } else {
        checks.failing += 1
      }
    } else {
      invalidGhJson()
    }
  }

  return {
    kind: "ready",
    number: value.number,
    state: value.state as "OPEN" | "CLOSED" | "MERGED",
    checks,
  }
}

export async function collectPullRequest(input: {
  cwd: string
  branch: string
  runner?: CommandRunner
  signal?: AbortSignal
}): Promise<PullRequestState> {
  const runner = input.runner ?? runCommand
  const result = await runner(
    "gh",
    ["pr", "view", input.branch, "--json", "number,state,statusCheckRollup"],
    { cwd: input.cwd, timeoutMs: 10_000, signal: input.signal },
  )

  if (result.ok) {
    return parsePullRequestJson(result.stdout)
  }

  if (result.reason === "missing") {
    return { kind: "unavailable", message: "GitHub unavailable" }
  }

  if (result.reason === "exit" && /no pull requests found for branch/i.test(result.stderr)) {
    return { kind: "none" }
  }

  if (
    result.reason === "exit" &&
    (/authenticat|not logged in|gh auth login|HTTP 401/i.test(result.stderr) ||
      /known GitHub host|not a GitHub repository|unsupported remote|no git remotes found/i.test(
        result.stderr,
      ))
  ) {
    return { kind: "unavailable", message: "GitHub unavailable" }
  }

  throw new Error(result.stderr.trim() || `GitHub collection failed: ${result.reason ?? "exit"}`)
}
