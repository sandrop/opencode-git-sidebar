import {
	type CommandResult,
	type CommandRunner,
	runCommand,
} from "./command.js";

type GitStatus = {
	branch: string;
	staged: number;
	modified: number;
	untracked: number;
};

export type GitState =
	| { repository: false }
	| ({
			repository: true;
			worktreePath: string;
			workingTreePath: string;
	  } & GitStatus);

export class GitCollectionError extends Error {
	readonly reason: NonNullable<CommandResult["reason"]>;

	constructor(reason: NonNullable<CommandResult["reason"]>, stderr: string) {
		super(stderr.trim() || `Git status failed: ${reason}`);
		this.name = "GitCollectionError";
		this.reason = reason;
	}
}

export function parseGitStatus(output: string): GitStatus {
	let branch = "";
	let staged = 0;
	let modified = 0;
	let untracked = 0;

	for (const line of output.split("\n")) {
		if (line.startsWith("# branch.head ")) {
			const head = line.slice("# branch.head ".length);
			branch = head === "(detached)" ? "detached HEAD" : head;
			continue;
		}

		if (line.startsWith("? ")) {
			untracked += 1;
			continue;
		}

		if (/^[12u] /.test(line)) {
			const status = line.slice(2, 4);
			if (status[0] !== ".") staged += 1;
			if (status[1] !== ".") modified += 1;
		}
	}

	return { branch, staged, modified, untracked };
}

export async function collectGitState(input: {
	workingTreePath: string;
	runner?: CommandRunner;
	signal?: AbortSignal;
}): Promise<GitState> {
	const runner = input.runner ?? runCommand;
	const git = async (args: string[]): Promise<string | undefined> => {
		const result = await runner("git", args, {
			cwd: input.workingTreePath,
			timeoutMs: 2_000,
			signal: input.signal,
			env: { ...process.env, LANG: "C", LC_ALL: "C" },
		});
		if (result.ok) return result.stdout;
		if (
			result.reason === "exit" &&
			/not a git repository/i.test(result.stderr)
		) {
			return undefined;
		}
		throw new GitCollectionError(result.reason ?? "exit", result.stderr);
	};

	const root = await git(["rev-parse", "--show-toplevel"]);
	if (root === undefined) return { repository: false };
	const status = await git([
		"status",
		"--porcelain=v2",
		"--branch",
		"--untracked-files=all",
	]);
	if (status === undefined) return { repository: false };

	return {
		repository: true,
		worktreePath: root.replace(/\r?\n$/, ""),
		workingTreePath: input.workingTreePath,
		...parseGitStatus(status),
	};
}
