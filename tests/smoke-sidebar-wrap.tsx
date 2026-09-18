import assert from "node:assert/strict";
import { testRender } from "@opentui/solid";
import { GitSidebar } from "../src/sidebar.js";

const branch =
	"fix-OPS-0021-fix-opencode-git-sidebar-worktree-pr-branch-display-bugs";
const worktree = `/repo/worktrees/${branch}`;
const screen = await testRender(
	() =>
		GitSidebar({
			onRefresh: () => {},
			snapshot: {
				local: {
					value: {
						repository: true,
						branch,
						worktreePath: worktree,
						workingTreePath: worktree,
						staged: 0,
						modified: 12,
						untracked: 0,
					},
					stale: false,
					status: "ready",
				},
				remote: { value: { kind: "none" }, stale: false, status: "ready" },
			},
		}),
	{ width: 28, height: 40 },
);

try {
	await screen.renderOnce();
	const rows = screen
		.captureCharFrame()
		.split("\n")
		.map((row) => row.trimEnd());
	const valueRows = (header: string) => {
		const start = rows.indexOf(header);
		assert.ok(start >= 0, `missing header: ${header}`);
		const rest = rows.slice(start + 1);
		const end = rest.indexOf("----------------------------");
		return end === -1 ? rest : rest.slice(0, end);
	};
	const branchRows = valueRows("BRANCH");
	assert.ok(
		branchRows.length > 1,
		`long branch must wrap to multiple rows: ${branch}\n${rows.join("\n")}`,
	);
	assert.equal(branchRows.join(""), branch);
	assert.equal(valueRows("WORKTREE").join(""), `worktrees/${branch}`);
	assert.equal(valueRows("WORKING DIRECTORY").join(""), `worktrees/${branch}`);
	assert.ok(rows.includes("12 modified"));
	assert.ok(rows.includes("no pull request"));
} finally {
	screen.renderer.destroy();
}
process.stdout.write("wrapped sidebar verified\n");
