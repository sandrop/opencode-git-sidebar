import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { collectGitState } from "../src/git.js";

it("collects staged, modified, and untracked files from a real repository", async () => {
	const repository = realpathSync(
		mkdtempSync(join(tmpdir(), "opencode-git-sidebar-")),
	);
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: repository });

	git("init", "-b", "task-2");
	git("config", "user.name", "OpenCode Git Sidebar Test");
	git("config", "user.email", "test@opencode-git-sidebar.invalid");
	writeFileSync(
		join(repository, "committed.ts"),
		"export const committed = true\n",
	);
	git("add", "committed.ts");
	git("commit", "-m", "test fixture");

	writeFileSync(join(repository, "staged.ts"), "export const staged = true\n");
	git("add", "staged.ts");
	writeFileSync(
		join(repository, "committed.ts"),
		"export const committed = false\n",
	);
	writeFileSync(
		join(repository, "untracked.ts"),
		"export const untracked = true\n",
	);
	mkdirSync(join(repository, "nested"));
	writeFileSync(
		join(repository, "nested", "one.ts"),
		"export const one = true\n",
	);
	writeFileSync(
		join(repository, "nested", "two.ts"),
		"export const two = true\n",
	);

	await expect(
		collectGitState({ workingTreePath: repository }),
	).resolves.toEqual({
		repository: true,
		branch: "task-2",
		worktreePath: repository,
		workingTreePath: repository,
		staged: 1,
		modified: 1,
		untracked: 3,
	});
});

it("collects the linked checkout at its root and a nested directory independently of main", async () => {
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "opencode-sidebar-worktree-")),
	);
	const repository = join(root, "primary");
	const worktree = join(root, "linked");
	const nested = join(worktree, "nested");
	mkdirSync(repository);
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: repository });
	git("init", "-b", "main");
	git(
		"-c",
		"user.name=OpenCode Git Sidebar Test",
		"-c",
		"user.email=test@opencode-git-sidebar.invalid",
		"commit",
		"--allow-empty",
		"-m",
		"test fixture",
	);
	git("worktree", "add", "-b", "feature", worktree);
	mkdirSync(nested);
	writeFileSync(
		join(worktree, "untracked.ts"),
		"export const untracked = true\n",
	);

	for (const directory of [worktree, nested]) {
		await expect(
			collectGitState({ workingTreePath: directory }),
		).resolves.toEqual({
			repository: true,
			branch: "feature",
			worktreePath: worktree,
			workingTreePath: directory,
			staged: 0,
			modified: 0,
			untracked: 1,
		});
	}
	await expect(
		collectGitState({ workingTreePath: repository }),
	).resolves.toMatchObject({ branch: "main", untracked: 0 });
});
