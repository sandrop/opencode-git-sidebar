import { describe, expect, it, vi } from "vitest";
import {
	collectGitState,
	GitCollectionError,
	parseGitStatus,
} from "../src/git.js";

describe("parseGitStatus", () => {
	it("counts staged, modified, and untracked entries", () => {
		const output = [
			"# branch.head feat/sidebar",
			"1 M. N... 100644 100644 100644 abc abc staged.ts",
			"1 .M N... 100644 100644 100644 abc abc modified.ts",
			"? untracked.ts",
		].join("\n");

		expect(parseGitStatus(output)).toEqual({
			branch: "feat/sidebar",
			staged: 1,
			modified: 1,
			untracked: 1,
		});
	});

	it("maps a detached branch and clean tree", () => {
		expect(parseGitStatus("# branch.head (detached)\n")).toEqual({
			branch: "detached HEAD",
			staged: 0,
			modified: 0,
			untracked: 0,
		});
	});

	it("counts a renamed path once per index and worktree category", () => {
		const output =
			"2 RM N... 100644 100644 100644 abc def R100 renamed.ts\toriginal.ts\n";

		expect(parseGitStatus(output)).toEqual({
			branch: "",
			staged: 1,
			modified: 1,
			untracked: 0,
		});
	});

	it("counts an unmerged path once per index and worktree category", () => {
		const output =
			"u UU N... 100644 100644 100644 100644 abc def ghi conflicted.ts\n";

		expect(parseGitStatus(output)).toEqual({
			branch: "",
			staged: 1,
			modified: 1,
			untracked: 0,
		});
	});
});

it("resolves the linked worktree root from the effective directory", async () => {
	const signal = new AbortController().signal;
	const runner = vi
		.fn()
		.mockResolvedValueOnce({ ok: true, stdout: "/repo/worktree\n", stderr: "" })
		.mockResolvedValueOnce({
			ok: true,
			stdout: "# branch.head feature\n",
			stderr: "",
		});
	await expect(
		collectGitState({
			workingTreePath: "/repo/worktree/nested",
			runner,
			signal,
		}),
	).resolves.toMatchObject({
		repository: true,
		branch: "feature",
		worktreePath: "/repo/worktree",
		workingTreePath: "/repo/worktree/nested",
	});
	expect(runner).toHaveBeenNthCalledWith(
		1,
		"git",
		["rev-parse", "--show-toplevel"],
		expect.objectContaining({
			cwd: "/repo/worktree/nested",
			signal,
			timeoutMs: 2_000,
		}),
	);
	expect(runner).toHaveBeenNthCalledWith(
		2,
		"git",
		["status", "--porcelain=v2", "--branch", "--untracked-files=all"],
		expect.objectContaining({ cwd: "/repo/worktree/nested", signal }),
	);
});

it("stops after a root lookup confirms a non-repository", async () => {
	const runner = vi.fn().mockResolvedValue({
		ok: false,
		stdout: "",
		stderr: "fatal: not a git repository",
		reason: "exit",
	});
	await expect(
		collectGitState({ workingTreePath: "/repo", runner }),
	).resolves.toEqual({ repository: false });
	expect(runner).toHaveBeenCalledTimes(1);
});

it.each(["timeout", "aborted", "missing"] as const)(
	"propagates root lookup failure: %s",
	async (reason) => {
		const runner = vi
			.fn()
			.mockResolvedValue({ ok: false, stdout: "", stderr: "", reason });
		await expect(
			collectGitState({ workingTreePath: "/repo", runner }),
		).rejects.toMatchObject({ name: "GitCollectionError", reason });
		expect(runner).toHaveBeenCalledTimes(1);
	},
);

it("preserves status failures after root discovery", async () => {
	const runner = vi
		.fn()
		.mockResolvedValueOnce({ ok: true, stdout: "/repo\n", stderr: "" })
		.mockResolvedValueOnce({
			ok: false,
			stdout: "",
			stderr: "status failed",
			reason: "exit",
		});
	await expect(
		collectGitState({ workingTreePath: "/repo", runner }),
	).rejects.toBeInstanceOf(GitCollectionError);
});

it("retains matching absolute worktree and working-tree paths for a normal checkout", async () => {
	const runner = vi
		.fn()
		.mockResolvedValueOnce({ ok: true, stdout: "/repo/sidebar\n", stderr: "" })
		.mockResolvedValue({
			ok: true,
			stdout: "# branch.head feat/sidebar\n? new.ts\n",
			stderr: "",
		});

	await expect(
		collectGitState({
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
	});
	expect(runner).toHaveBeenCalledWith(
		"git",
		["status", "--porcelain=v2", "--branch", "--untracked-files=all"],
		expect.objectContaining({
			cwd: "/repo/sidebar",
			env: expect.objectContaining({ LANG: "C", LC_ALL: "C" }),
		}),
	);
});

it("retains distinct absolute worktree and working-tree paths for an isolated checkout", async () => {
	const runner = vi
		.fn()
		.mockResolvedValueOnce({
			ok: true,
			stdout: "/repo/worktrees/sidebar\n",
			stderr: "",
		})
		.mockResolvedValue({
			ok: true,
			stdout: "# branch.head feat/sidebar\n",
			stderr: "",
		});

	await expect(
		collectGitState({
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
	});
});
