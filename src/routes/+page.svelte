<script lang="ts">
	import { onMount } from "svelte";
	import GameBoard from "$lib/GameBoard.svelte";
	import type { StoneData } from "../../shared/types.ts";

	let size = $state(14);
	let moves: StoneData[] = $state([]);

	let isMultiplayerEnabled = $state(false);
	let playerMode: 1 | { socket: WebSocket } = $state(1);

	const wsUrlStorageKey = "continuous-connection-game.wsUrl";
	const wsEnabledStorageKey = "continuous-connection-game.wsEnabled";
	let wsUrl = $state("");
	let wsUrlDraft = $state("");
	let wsUrlError = $state<string | null>(null);

	const isValidWsUrl = (s: string): boolean => {
		const trimmed = s.trim();
		if (!trimmed) return false;
		if (!trimmed.startsWith("ws://") && !trimmed.startsWith("wss://"))
			return false;
		return true;
	};

	const defaultWsUrl = (): string => {
		const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
		return `${wsProtocol}://${location.hostname}:8090`;
	};

	let socket: WebSocket | null = null;

	const disconnect = (): void => {
		socket?.close();
		socket = null;
		playerMode = 1;
	};

	const connect = (nextUrl: string): void => {
		const trimmed = nextUrl.trim();
		if (!isValidWsUrl(trimmed)) {
			wsUrlError = "Must start with ws:// or wss://";
			return;
		}

		wsUrlError = null;
		wsUrl = trimmed;

		let ok: boolean;
		let err: unknown;
		let result: WebSocket | null = null;
		try {
			result = new WebSocket(trimmed);
			ok = true;
		} catch (e) {
			err = e;
			ok = false;
		}

		if (!ok || !result) {
			wsUrlError = `Could not connect: ${String(err)}`;
			return;
		}

		socket?.close();
		socket = result;
		playerMode = { socket: result };
	};

	const saveWsUrl = (): void => {
		const trimmed = wsUrlDraft.trim();
		try {
			localStorage.setItem(wsUrlStorageKey, trimmed);
		} catch {}

		wsUrl = trimmed;
		wsUrlError = null;
		if (isMultiplayerEnabled) connect(trimmed);
	};

	const setMultiplayerEnabled = (next: boolean): void => {
		isMultiplayerEnabled = next;
		try {
			localStorage.setItem(wsEnabledStorageKey, next ? "1" : "0");
		} catch {}

		if (next) connect(wsUrlDraft);
		else disconnect();
	};

	onMount(() => {
		const url = new URL(location.href);
		const fromQuery = url.searchParams.get("ws");
		const relayTarget = url.searchParams.get("relay_target");
		const relaySecure = url.searchParams.get("relay_secure") === "true";
		const fromQueryEnabled = url.searchParams.get("mp");

		let fromStorageUrl: string | null = null;
		let fromStorageEnabled: string | null = null;
		try {
			fromStorageUrl = localStorage.getItem(wsUrlStorageKey);
		} catch {}
		try {
			fromStorageEnabled = localStorage.getItem(wsEnabledStorageKey);
		} catch {}

		const fromRelay =
			relayTarget && relayTarget.trim()
				? `${relaySecure ? "wss" : "ws"}://${relayTarget.trim()}`
				: null;

		const initialUrl =
			(fromRelay && isValidWsUrl(fromRelay) && fromRelay) ||
			(fromQuery && isValidWsUrl(fromQuery) && fromQuery) ||
			(fromStorageUrl && isValidWsUrl(fromStorageUrl) && fromStorageUrl) ||
			defaultWsUrl();

		wsUrlDraft = initialUrl;
		wsUrl = initialUrl;

		const initialEnabled =
			fromQueryEnabled === "1" || (fromStorageEnabled ?? "0") === "1";

		if (initialEnabled) setMultiplayerEnabled(true);

		return () => {
			disconnect();
		};
	});
</script>

<GameBoard
	bind:size
	bind:moves
	{playerMode}
	{wsUrl}
	bind:wsUrlDraft
	{wsUrlError}
	{saveWsUrl}
	{isMultiplayerEnabled}
	{setMultiplayerEnabled}
/>
