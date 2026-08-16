import { execFile } from "node:child_process"

export type CommandResult = {
  ok: boolean
  stdout: string
  stderr: string
  reason?: "exit" | "missing" | "timeout" | "aborted"
}

export type CommandRunner = (
  executable: string,
  args: readonly string[],
  input: { cwd: string; timeoutMs: number; signal?: AbortSignal },
) => Promise<CommandResult>

export const runCommand: CommandRunner = (executable, args, input) =>
  new Promise((resolve) => {
    execFile(
      executable,
      [...args],
      {
        cwd: input.cwd,
        timeout: input.timeoutMs,
        signal: input.signal,
        shell: false,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ ok: true, stdout, stderr })
          return
        }

        const commandError = error as NodeJS.ErrnoException & { killed?: boolean }
        let reason: NonNullable<CommandResult["reason"]> = "exit"
        if (commandError.code === "ENOENT") {
          reason = "missing"
        } else if (
          input.signal?.aborted ||
          commandError.code === "ABORT_ERR" ||
          commandError.name === "AbortError"
        ) {
          reason = "aborted"
        } else if (commandError.killed) {
          reason = "timeout"
        }

        resolve({ ok: false, stdout, stderr, reason })
      },
    )
  })
