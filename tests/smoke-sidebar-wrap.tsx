import assert from "node:assert/strict";
import { testRender } from "@opentui/solid";
import { jsx } from "@opentui/solid/jsx-runtime";
import { GitSidebar } from "../src/sidebar.js";

const branch =
	"fix-OPS-0021-fix-opencode-git-sidebar-worktree-pr-branch-display-bugs";
const worktree = `/repo/worktrees/${branch}`;
const screen = await testRender(
	() =>
		jsx("box", {
			width: "100%",
			paddingLeft: 2,
			paddingRight: 2,
			children: jsx("box", {
				width: "100%",
				paddingRight: 1,
				children: GitSidebar({
					onRefresh: () => {},
					snapshot: {
						local: {
							value: {
								repository: true,
								branch,
								worktreePath: worktree,
								workingTreePath: worktree,
								staged: 2,
								modified: 3,
								untracked: 1,
							},
							stale: false,
							status: "ready",
						},
						remote: {
							value: {
								kind: "ready",
								number: 142,
								state: "OPEN",
								checks: { total: 8, passing: 8, pending: 0, failing: 0 },
							},
							stale: false,
							status: "ready",
						},
					},
				}),
			}),
		}),
	{ width: 42, height: 60 },
);

try {
	for (const [width, status, pr] of [
		[42, "2 staged | 3 modified | 1 untracked", "#142 OPEN | 8/8 passing"],
		[24, "2 S | 3 mod | 1 new", "#142 OPEN | 8/8 ok"],
		[50, "2 staged | 3 modified | 1 untracked", "#142 OPEN | 8/8 passing"],
	] as const) {
		screen.resize(width, 60);
		await screen.renderOnce();
		await screen.flush();
		const rawRows = screen.captureCharFrame().split("\n");
		const contentWidth = width - 5;
		assert.equal(
			rawRows[0].slice(width - 10, width - 3),
			"refresh",
			"refresh must reach the host content edge",
		);
		for (const row of rawRows.filter((line) => line.trim())) {
			assert.equal(row.slice(0, 2), "  ");
			assert.equal(row.slice(width - 3), "   ");
		}
		const rows = rawRows.map((row) => row.slice(2, width - 3).trimEnd());
		const divider = "-".repeat(contentWidth);
		assert.equal(
			rows.filter((row) => row === divider).length,
			4,
			"dividers must fill the host content width",
		);
		const valueRows = (header: string) => {
			const start = rows.indexOf(header);
			assert.ok(start >= 0, `missing header: ${header}`);
			const rest = rows.slice(start + 1);
			const end = rest.indexOf(divider);
			return end === -1 ? rest : rest.slice(0, end);
		};
		const branchRows = valueRows("BRANCH");
		assert.ok(
			branchRows.length > 1,
			`long branch must wrap to multiple rows: ${branch}\n${rows.join("\n")}`,
		);
		assert.equal(branchRows.join(""), branch);
		assert.equal(valueRows("WORKTREE").join(""), `worktrees/${branch}`);
		assert.equal(
			valueRows("WORKING DIRECTORY").join(""),
			`worktrees/${branch}`,
		);
		assert.ok(
			rows.includes(status),
			`status should use the measured width: ${contentWidth}`,
		);
		assert.ok(rows.includes(pr));
	}
} finally {
	screen.renderer.destroy();
}
process.stdout.write("wrapped sidebar verified\n");
