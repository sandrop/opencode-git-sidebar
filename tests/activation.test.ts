import type {
	TuiDispose,
	TuiPluginApi,
	TuiSlotPlugin,
} from "@opencode-ai/plugin/tui";
import { expect, it, vi } from "vitest";
import {
	createRefreshController,
	type RefreshController,
	type RefreshSnapshot,
} from "../src/refresh.js";
import { activate, resolveWorkingTreePath } from "../src/tui.js";

function directoryApi() {
	const sessionID = "session-a";
	const part = {
		id: "part-a",
		messageID: "message",
		sessionID,
		callID: "call",
		type: "tool" as const,
		tool: "bash",
		state: {
			status: "completed" as const,
			input: { workdir: "/repo/worktree" },
			output: "",
			title: "",
			metadata: {},
			time: { start: 2, end: 3 },
		},
	};
	const parts: Array<ReturnType<TuiPluginApi["state"]["part"]>[number]> = [
		part,
	];
	const session = { id: sessionID, directory: "/repo/session" };
	const get = vi.fn((): typeof session | undefined => session);
	const api = {
		route: { current: { name: "session", params: { sessionID } } },
		state: {
			path: { directory: "/repo/global" },
			session: { get, messages: () => [{ id: "message", sessionID }] },
			part: () => parts,
		},
	} as unknown as TuiPluginApi;
	return { api, part, parts, get };
}

it("keeps an unloaded session pending instead of collecting the launch checkout", () => {
	const { api, get } = directoryApi();
	get.mockReturnValue(undefined);
	expect(resolveWorkingTreePath(api)).toBeUndefined();
});

it("chooses the latest started completed Bash call even when older calls finish later", () => {
	const { api, part, parts } = directoryApi();
	parts.push({
		...part,
		id: "part-old",
		state: {
			...part.state,
			input: { workdir: "/repo/old" },
			time: { start: 1, end: 4 },
		},
	});
	expect(resolveWorkingTreePath(api)).toBe("/repo/worktree");
});

it("breaks equal start times by part ID regardless of part arrival order", () => {
	const { api, part, parts } = directoryApi();
	parts.unshift({
		...part,
		id: "part-z",
		state: { ...part.state, input: { workdir: "/repo/newer" } },
	});
	expect(resolveWorkingTreePath(api)).toBe("/repo/newer");
});

it.each(["", "relative/path", null, 42])(
	"ignores invalid workdirs: %s",
	(workdir) => {
		const { api, part, parts } = directoryApi();
		parts[0] = { ...part, state: { ...part.state, input: { workdir } } };
		expect(resolveWorkingTreePath(api)).toBe("/repo/session");
	},
);

it("ignores non-Bash, unfinished, failed, and other-session tools", () => {
	const { api, part, parts } = directoryApi();
	parts.splice(
		0,
		1,
		{ ...part, tool: "read" },
		{ ...part, sessionID: "session-b" },
		{
			...part,
			state: { status: "running", input: part.state.input, time: { start: 4 } },
		},
		{ ...part, state: { status: "pending", input: part.state.input, raw: "" } },
		{
			...part,
			state: {
				status: "error",
				input: part.state.input,
				error: "failed",
				time: { start: 5, end: 6 },
			},
		},
	);
	expect(resolveWorkingTreePath(api)).toBe("/repo/session");
});

it("isolates workdir selection across session routes and recovers when metadata arrives", () => {
	const { api, get } = directoryApi();
	expect(resolveWorkingTreePath(api)).toBe("/repo/worktree");
	Object.assign(api.route, {
		current: { name: "session", params: { sessionID: "session-b" } },
	});
	get.mockReturnValue(undefined);
	expect(resolveWorkingTreePath(api)).toBeUndefined();
	get.mockReturnValue({ id: "session-b", directory: "/repo/other" });
	expect(resolveWorkingTreePath(api)).toBe("/repo/other");
	Object.assign(api.route, {
		current: { name: "session", params: { sessionID: "session-a" } },
	});
	get.mockReturnValue({ id: "session-a", directory: "/repo/session" });
	expect(resolveWorkingTreePath(api)).toBe("/repo/worktree");
});

it.each(["home", "custom"])(
	"uses the global directory on the %s route",
	(name) => {
		const { api } = directoryApi();
		Object.assign(api.route, { current: { name } });
		expect(resolveWorkingTreePath(api)).toBe("/repo/global");
	},
);

it("keeps malformed session routes pending", () => {
	const { api } = directoryApi();
	Object.assign(api.route, { current: { name: "session", params: {} } });
	expect(resolveWorkingTreePath(api)).toBeUndefined();
});

it("follows the session Bash workdir after activation", async () => {
	vi.useFakeTimers();
	const directory = "/repo/session";
	const worktree = "/repo/worktree";
	const branch =
		"fix-OPS-0021-fix-opencode-git-sidebar-worktree-pr-branch-display-bugs";
	const sessionID = "session-a";
	const parts: Array<ReturnType<TuiPluginApi["state"]["part"]>[number]> = [];
	const disposals: TuiDispose[] = [];
	const snapshots: RefreshSnapshot[] = [];
	const api = {
		route: { current: { name: "session", params: { sessionID } } },
		state: {
			path: { worktree: directory, directory },
			vcs: { branch: "main" },
			session: {
				get: () => ({ id: sessionID, directory }),
				messages: () => [{ id: "message", sessionID }],
			},
			part: () => parts,
		},
		slots: { register: vi.fn(() => "git-sidebar") },
		keymap: { registerLayer: vi.fn(() => vi.fn()) },
		lifecycle: { onDispose: (dispose: TuiDispose) => disposals.push(dispose) },
	} as unknown as TuiPluginApi;
	const remote = vi.fn().mockResolvedValue({ kind: "none" });

	try {
		await activate(api, undefined, {
			createRefreshController: (input) =>
				createRefreshController({
					...input,
					onChange: (snapshot) => {
						snapshots.push(snapshot);
						input.onChange(snapshot);
					},
				}),
			collectLocal: async ({ workingTreePath }) => ({
				repository: true,
				branch: workingTreePath === worktree ? branch : "main",
				worktreePath: workingTreePath,
				workingTreePath,
				staged: 0,
				modified: workingTreePath === worktree ? 3 : 0,
				untracked: 0,
			}),
			collectRemote: remote,
		});
		await vi.advanceTimersByTimeAsync(0);
		parts.push({
			id: "part",
			messageID: "message",
			sessionID,
			callID: "call",
			type: "tool",
			tool: "bash",
			state: {
				status: "completed",
				input: { workdir: worktree },
				output: "",
				title: "",
				metadata: {},
				time: { start: 1, end: 2 },
			},
		});
		await vi.advanceTimersByTimeAsync(10_000);

		expect(snapshots.at(-1)?.local.value).toMatchObject({
			repository: true,
			branch,
			worktreePath: worktree,
			workingTreePath: worktree,
			modified: 3,
		});
		expect(remote).toHaveBeenLastCalledWith(
			expect.objectContaining({ cwd: worktree, branch }),
		);
		expect(snapshots.at(-1)?.remote.value).toEqual({ kind: "none" });
	} finally {
		for (const dispose of disposals) await dispose();
		vi.useRealTimers();
	}
});

it("activates the sidebar, palette refresh, and controller lifecycle", async () => {
	const slotPlugins: TuiSlotPlugin[] = [];
	const commandLayers: Array<
		Parameters<TuiPluginApi["keymap"]["registerLayer"]>[0]
	> = [];
	const disposals: TuiDispose[] = [];
	const disposeCommandLayer = vi.fn();
	const api = {
		route: { current: { name: "home" } },
		state: {
			path: { worktree: "/repo/worktree", directory: "/repo/directory" },
			vcs: { branch: "feat/sidebar" },
		},
		slots: {
			register: vi.fn((plugin: TuiSlotPlugin) => {
				slotPlugins.push(plugin);
				return "git-sidebar";
			}),
		},
		keymap: {
			registerLayer: vi.fn((layer: (typeof commandLayers)[number]) => {
				commandLayers.push(layer);
				return disposeCommandLayer;
			}),
		},
		lifecycle: {
			onDispose: vi.fn((dispose: TuiDispose) => {
				disposals.push(dispose);
				return vi.fn();
			}),
		},
	} as unknown as TuiPluginApi;
	const controller = {
		start: vi.fn(),
		refreshLocal: vi.fn(),
		refreshRemote: vi.fn(),
		refreshAll: vi.fn(),
		dispose: vi.fn(),
	} satisfies RefreshController;
	const createController = vi.fn<typeof createRefreshController>(
		() => controller,
	);
	const deps = {
		runner: vi.fn(),
		collectLocal: vi.fn(),
		collectRemote: vi.fn(),
		createRefreshController: createController,
	};

	await activate(api, { localRefreshMs: 5_000 }, deps);

	expect(api.slots.register).toHaveBeenCalledTimes(1);
	expect(slotPlugins).toHaveLength(1);
	expect(api.keymap.registerLayer).toHaveBeenCalledWith({
		commands: [
			expect.objectContaining({
				name: "git-sidebar.refresh",
				title: "Git Sidebar: Refresh",
				category: "Plugin",
				namespace: "palette",
			}),
		],
	});
	expect(deps.createRefreshController).toHaveBeenCalledWith(
		expect.objectContaining({
			options: { localRefreshMs: 5_000, remoteRefreshMs: 30_000 },
		}),
	);
	const controllerInput = deps.createRefreshController.mock.calls[0][0];
	expect(controllerInput.context()).toEqual({
		worktreePath: "/repo/directory",
		workingTreePath: "/repo/directory",
		branch: "feat/sidebar",
	});
	api.state.path.worktree = "";
	api.state.path.directory = "/repo/checkout";
	expect(controllerInput.context()).toEqual({
		worktreePath: "/repo/checkout",
		workingTreePath: "/repo/checkout",
		branch: "feat/sidebar",
	});
	expect(controller.start).toHaveBeenCalledTimes(1);

	await commandLayers[0].commands?.[0].run({} as never);
	expect(controller.refreshAll).toHaveBeenCalledTimes(1);

	await disposals[0]();
	expect(disposeCommandLayer).toHaveBeenCalledTimes(1);
	expect(controller.dispose).toHaveBeenCalledTimes(1);
});

it("removes the palette command before reactivation", async () => {
	const commandLayers: Array<
		Parameters<TuiPluginApi["keymap"]["registerLayer"]>[0]
	> = [];
	const disposals: TuiDispose[] = [];
	const api = {
		route: { current: { name: "home" } },
		state: {
			path: { worktree: "/repo/worktree", directory: "/repo/directory" },
			vcs: { branch: "feat/sidebar" },
		},
		slots: { register: vi.fn(() => "git-sidebar") },
		keymap: {
			registerLayer: vi.fn((layer: (typeof commandLayers)[number]) => {
				commandLayers.push(layer);
				return () => {
					const index = commandLayers.indexOf(layer);
					if (index >= 0) commandLayers.splice(index, 1);
				};
			}),
		},
		lifecycle: {
			onDispose: vi.fn((dispose: TuiDispose) => {
				disposals.push(dispose);
				return vi.fn();
			}),
		},
	} as unknown as TuiPluginApi;
	const controllers: RefreshController[] = [];
	const createController = vi.fn<typeof createRefreshController>(() => {
		const controller = {
			start: vi.fn(),
			refreshLocal: vi.fn(),
			refreshRemote: vi.fn(),
			refreshAll: vi.fn(),
			dispose: vi.fn(),
		} satisfies RefreshController;
		controllers.push(controller);
		return controller;
	});
	const deps = {
		runner: vi.fn(),
		collectLocal: vi.fn(),
		collectRemote: vi.fn(),
		createRefreshController: createController,
	};

	await activate(api, undefined, deps);
	expect(commandLayers).toHaveLength(1);

	await disposals[0]();
	await activate(api, undefined, deps);

	expect(commandLayers).toHaveLength(1);
	await commandLayers[0].commands?.[0].run({} as never);
	expect(controllers[0].refreshAll).not.toHaveBeenCalled();
	expect(controllers[1].refreshAll).toHaveBeenCalledTimes(1);
});
