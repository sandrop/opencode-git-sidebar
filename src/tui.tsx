/** @jsxImportSource @opentui/solid */

import { isAbsolute } from "node:path";
import type {
	TuiPlugin,
	TuiPluginApi,
	TuiPluginModule,
} from "@opencode-ai/plugin/tui";
import { createSignal } from "solid-js";
import { type CommandRunner, runCommand } from "./command.js";
import { collectGitState } from "./git.js";
import { collectPullRequest } from "./github.js";
import {
	createRefreshController,
	initialRefreshSnapshot,
	type RefreshSnapshot,
} from "./refresh.js";
import { sidebarSlot } from "./sidebar.js";

export const DEFAULT_OPTIONS = {
	localRefreshMs: 10_000,
	remoteRefreshMs: 30_000,
} as const;

export type PluginOptions = {
	localRefreshMs?: unknown;
	remoteRefreshMs?: unknown;
};

export type ResolvedOptions = {
	localRefreshMs: number;
	remoteRefreshMs: number;
};

const interval = (value: unknown, fallback: number) =>
	typeof value === "number" &&
	Number.isFinite(value) &&
	Number.isInteger(value) &&
	value > 0
		? value
		: fallback;

export function resolveOptions(
	options: PluginOptions | undefined,
): ResolvedOptions {
	return {
		localRefreshMs: interval(
			options?.localRefreshMs,
			DEFAULT_OPTIONS.localRefreshMs,
		),
		remoteRefreshMs: interval(
			options?.remoteRefreshMs,
			DEFAULT_OPTIONS.remoteRefreshMs,
		),
	};
}

export type ActivationDependencies = {
	runner: CommandRunner;
	collectLocal: typeof collectGitState;
	collectRemote: typeof collectPullRequest;
	createRefreshController: typeof createRefreshController;
};

const defaultDependencies: ActivationDependencies = {
	runner: runCommand,
	collectLocal: collectGitState,
	collectRemote: collectPullRequest,
	createRefreshController,
};

export function resolveWorkingTreePath(api: TuiPluginApi): string | undefined {
	const route = api.route.current;
	if (route.name !== "session") return api.state.path.directory;
	if (!("params" in route)) return undefined;
	const sessionID = route.params?.sessionID;
	if (typeof sessionID !== "string") return undefined;
	const session = api.state.session.get(sessionID);
	if (!session) return undefined;
	let directory = session.directory;
	let latest = -Infinity;
	let latestID = "";
	for (const message of api.state.session.messages(sessionID)) {
		for (const part of api.state.part(message.id)) {
			if (
				part.type !== "tool" ||
				part.tool !== "bash" ||
				part.sessionID !== sessionID
			)
				continue;
			const state = part.state;
			if (state.status !== "completed" || state.time.start < latest) continue;
			if (state.time.start === latest && part.id <= latestID) continue;
			const workdir = state.input.workdir;
			if (typeof workdir !== "string" || !isAbsolute(workdir)) continue;
			latest = state.time.start;
			latestID = part.id;
			directory = workdir;
		}
	}
	return directory;
}

export async function activate(
	api: TuiPluginApi,
	options: PluginOptions | undefined,
	dependencies: Partial<ActivationDependencies> = {},
): Promise<void> {
	const deps = { ...defaultDependencies, ...dependencies };
	const [snapshot, setSnapshot] = createSignal<RefreshSnapshot>(
		initialRefreshSnapshot(),
	);
	const controller = deps.createRefreshController({
		options: resolveOptions(options),
		context: () => {
			const directory = resolveWorkingTreePath(api);
			if (directory === undefined) return undefined;
			return {
				worktreePath: directory,
				workingTreePath: directory,
				branch: api.state.vcs?.branch ?? "",
			};
		},
		collectLocal: ({ workingTreePath, signal }) =>
			deps.collectLocal({ workingTreePath, signal, runner: deps.runner }),
		collectRemote: ({ worktreePath, branch, signal }) =>
			deps.collectRemote({
				cwd: worktreePath,
				branch,
				signal,
				runner: deps.runner,
			}),
		onChange: (next) => setSnapshot(next),
	});

	api.slots.register(
		sidebarSlot(api, snapshot, () => void controller.refreshAll()),
	);
	const disposeCommandLayer = api.keymap.registerLayer({
		commands: [
			{
				name: "git-sidebar.refresh",
				title: "Git Sidebar: Refresh",
				category: "Plugin",
				namespace: "palette",
				run: () => controller.refreshAll(),
			},
		],
	});
	api.lifecycle.onDispose(() => {
		disposeCommandLayer();
		controller.dispose();
	});
	controller.start();
}

const tui: TuiPlugin = async (api, options) => {
	await activate(api, options);
};

const plugin: TuiPluginModule & { id: string } = {
	id: "opencode-git-sidebar",
	tui,
};

export default plugin;
