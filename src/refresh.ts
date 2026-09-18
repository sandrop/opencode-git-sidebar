import type { GitState } from "./git.js";
import type { PullRequestState } from "./github.js";
import type { ResolvedOptions } from "./tui.js";

export type RefreshValue<T> = {
	value: T | null;
	stale: boolean;
	status: "loading" | "ready" | "error";
};

export type RefreshSnapshot = {
	local: RefreshValue<GitState>;
	remote: RefreshValue<PullRequestState>;
};

export type RefreshController = {
	start(): void;
	refreshLocal(): Promise<void>;
	refreshRemote(): Promise<void>;
	refreshAll(): Promise<void>;
	dispose(): void;
};

type RefreshContext = {
	worktreePath: string;
	workingTreePath: string;
	branch: string;
};

const loading = <T>(): RefreshValue<T> => ({
	value: null,
	stale: false,
	status: "loading",
});

export const initialRefreshSnapshot = (): RefreshSnapshot => ({
	local: loading(),
	remote: loading(),
});

export function createRefreshController(deps: {
	options: ResolvedOptions;
	context: () => RefreshContext | undefined;
	collectLocal: (
		input: Pick<RefreshContext, "worktreePath" | "workingTreePath"> & {
			signal: AbortSignal;
		},
	) => Promise<GitState>;
	collectRemote: (
		input: RefreshContext & { signal: AbortSignal },
	) => Promise<PullRequestState>;
	onChange: (snapshot: RefreshSnapshot) => void;
}): RefreshController {
	const abortController = new AbortController();
	let localTimer: ReturnType<typeof setInterval> | undefined;
	let remoteTimer: ReturnType<typeof setInterval> | undefined;
	let localInFlight: Promise<void> | undefined;
	let localInFlightKey: string | undefined;
	let remoteInFlight: Promise<void> | undefined;
	let remoteInFlightKey: string | undefined;
	// Host branch state can lag Git, so host observation and effective collection context stay separate.
	let observedHostKey: string | undefined;
	let activeContext: RefreshContext | undefined;
	let contextVersion = 0;
	let disposed = false;
	let snapshot = initialRefreshSnapshot();

	const notify = () => {
		if (!disposed) deps.onChange(snapshot);
	};

	const keyFor = (context: RefreshContext | undefined) =>
		context
			? `${context.worktreePath}\0${context.workingTreePath}\0${context.branch}`
			: "";

	const observeContext = () => {
		const hostContext = deps.context();
		const hostKey = keyFor(hostContext);
		if (observedHostKey === undefined) {
			observedHostKey = hostKey;
			activeContext = hostContext;
			return { context: activeContext, changed: false };
		}
		if (hostKey === observedHostKey)
			return { context: activeContext, changed: false };

		observedHostKey = hostKey;
		if (keyFor(hostContext) === keyFor(activeContext)) {
			return { context: activeContext, changed: false };
		}

		activeContext = hostContext;
		contextVersion += 1;
		snapshot = initialRefreshSnapshot();
		notify();
		return { context: activeContext, changed: true };
	};

	const failed = <T>(current: RefreshValue<T>): RefreshValue<T> =>
		current.value === null
			? { value: null, stale: false, status: "error" }
			: { ...current, stale: true };

	const refreshLocal = (refreshRemoteAfterQueue = false): Promise<void> => {
		if (disposed) return Promise.resolve();
		const observed = observeContext();
		const context = observed.context;
		if (!context) return Promise.resolve();
		const contextKey = keyFor(context);
		const version = contextVersion;
		if (localInFlight) {
			if (localInFlightKey === contextKey) return localInFlight;
			return localInFlight.then(() =>
				disposed
					? undefined
					: refreshLocal(refreshRemoteAfterQueue || observed.changed),
			);
		}

		const operation = (async () => {
			let refreshRemoteAfter = refreshRemoteAfterQueue || observed.changed;
			try {
				const value = await deps.collectLocal({
					worktreePath: context.worktreePath,
					workingTreePath: context.workingTreePath,
					signal: abortController.signal,
				});
				if (
					contextVersion !== version ||
					keyFor(activeContext ?? context) !== contextKey
				)
					return;

				if (
					value.repository &&
					(value.branch !== context.branch ||
						value.worktreePath !== context.worktreePath)
				) {
					activeContext = {
						...context,
						branch: value.branch,
						worktreePath: value.worktreePath,
					};
					contextVersion += 1;
					snapshot = {
						local: { value, stale: false, status: "ready" },
						remote: loading(),
					};
					refreshRemoteAfter = true;
				} else {
					snapshot = {
						...snapshot,
						local: { value, stale: false, status: "ready" },
					};
				}
			} catch {
				if (
					contextVersion !== version ||
					keyFor(activeContext ?? context) !== contextKey
				)
					return;
				snapshot = { ...snapshot, local: failed(snapshot.local) };
			}
			notify();
			if (refreshRemoteAfter) await refreshRemote();
		})().finally(() => {
			if (localInFlight === operation) {
				localInFlight = undefined;
				localInFlightKey = undefined;
			}
		});
		localInFlight = operation;
		localInFlightKey = contextKey;
		return operation;
	};

	const refreshRemote: RefreshController["refreshRemote"] = () => {
		if (disposed) return Promise.resolve();
		const observed = observeContext();
		const context = observed.context;
		if (!context) return Promise.resolve();
		// Resolve checkout identity before looking up a PR for a new context.
		if (snapshot.local.value === null) {
			if (snapshot.local.status === "error") return Promise.resolve();
			return refreshLocal().then(() => {
				if (
					!disposed &&
					snapshot.local.value?.repository &&
					snapshot.remote.status === "loading"
				) {
					return refreshRemote();
				}
			});
		}
		if (!snapshot.local.value.repository) return Promise.resolve();
		const contextKey = keyFor(context);
		const version = contextVersion;
		if (remoteInFlight) {
			const remoteRefresh =
				remoteInFlightKey === contextKey
					? remoteInFlight
					: remoteInFlight.then(() => (disposed ? undefined : refreshRemote()));
			return remoteRefresh;
		}

		const operation = (async () => {
			try {
				const value = await deps.collectRemote({
					...context,
					signal: abortController.signal,
				});
				if (
					contextVersion !== version ||
					keyFor(activeContext ?? context) !== contextKey
				)
					return;
				snapshot = {
					...snapshot,
					remote: { value, stale: false, status: "ready" },
				};
			} catch {
				if (
					contextVersion !== version ||
					keyFor(activeContext ?? context) !== contextKey
				)
					return;
				snapshot = { ...snapshot, remote: failed(snapshot.remote) };
			}
			notify();
		})().finally(() => {
			if (remoteInFlight === operation) {
				remoteInFlight = undefined;
				remoteInFlightKey = undefined;
			}
		});
		remoteInFlight = operation;
		remoteInFlightKey = contextKey;
		return operation;
	};

	const refreshAll = async () => {
		await Promise.all([refreshLocal(), refreshRemote()]);
	};

	return {
		start() {
			if (disposed || localTimer || remoteTimer) return;
			void refreshAll();
			localTimer = setInterval(
				() => void refreshLocal(),
				deps.options.localRefreshMs,
			);
			remoteTimer = setInterval(
				() => void refreshRemote(),
				deps.options.remoteRefreshMs,
			);
		},
		refreshLocal,
		refreshRemote,
		refreshAll,
		dispose() {
			disposed = true;
			if (localTimer) clearInterval(localTimer);
			if (remoteTimer) clearInterval(remoteTimer);
			localTimer = undefined;
			remoteTimer = undefined;
			abortController.abort();
		},
	};
}
