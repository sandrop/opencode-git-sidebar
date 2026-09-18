import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("renders complete branch and compact paths on multiple terminal rows", () => {
	const result = spawnSync("bun", ["tests/smoke-sidebar-wrap.tsx"], {
		cwd: process.cwd(),
		encoding: "utf8",
		timeout: 10_000,
	});
	expect(result.error, result.error?.message).toBeUndefined();
	expect(result.status, result.stderr).toBe(0);
	expect(result.stdout).toBe("wrapped sidebar verified\n");
});
