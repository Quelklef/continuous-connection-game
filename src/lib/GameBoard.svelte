<script lang="ts">
	import { Bad, ensureCoverage } from "../../shared/lib.ts";
	import type {
		ServerMessage,
		InnerClientMessage,
		ClockSettings,
		StoneData,
		Player,
		SharedPreviewOp,
		StableKey,
	} from "../../shared/types.ts";
	import {
		isBoardColors,
		isClockOp,
		isFiniteNumber,
		isTimedMoveData,
		isStoneData,
		isStampedOp,
		isValidBoardSize,
		isValidHexColor,
		MAX_BOARD_SIZE,
		MIN_BOARD_SIZE,
	} from "../../shared/validate.ts";
	import HistoryTree from "$lib/HistoryTree.svelte";
	import Toolbar from "$lib/Toolbar.svelte";
	import polygonClipping from "polygon-clipping";
	import {
		appendKey,
		keyDepth,
		parentKeyOf,
		rootKey,
	} from "$lib/history/stableKey";
	import {
		emptyOverlayState,
		overlayDeleteSubtree,
		overlayGet,
		overlaySubtreeKeys,
		overlayUpsertAdd,
	} from "$lib/sharedPreview/overlay";
	type Props = {
		size: number;
		moves: StoneData[];
		playerMode?: 1 | { socket: WebSocket };

		wsUrl?: string;
		wsUrlDraft?: string;
		wsUrlError?: string | null;
		saveWsUrl?: () => void;

		isMultiplayerEnabled?: boolean;
		setMultiplayerEnabled?: (next: boolean) => void;
	};
	let {
		size = $bindable(),
		moves = $bindable(),
		playerMode = 1,

		wsUrl = "",
		wsUrlDraft = $bindable(""),
		wsUrlError = null,
		saveWsUrl = undefined,

		isMultiplayerEnabled = false,
		setMultiplayerEnabled = undefined,
	}: Props = $props();

	type ViewBox = { x: number; y: number; w: number; h: number };
	const clamp = (v: number, min: number, max: number): number =>
		Math.min(max, Math.max(min, v));

	const minViewBoxSize = 1e-6;
	const minBoardSize = MIN_BOARD_SIZE;
	const maxBoardSize = MAX_BOARD_SIZE;
	let viewBox: ViewBox = $state({ x: 0, y: 0, w: 0, h: 0 });
	let lastSize = $state(0);
	let viewBoxStr = $derived(
		`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`,
	);

	let mouseLoc: [number, number] = $state([0, 0]);
	let mouseOver = $state(false);
	let mouseOverHistory = $state(false);
	let connected = $state(false);
	let id: number | null = null;
	let assignedPlayer: Player | null = $state(null);
	let svg: SVGSVGElement;
	let lastClientCoords: [number, number] | null = $state(null);
	const defaultPlayer1Color = "#e23d4f";
	const defaultPlayer2Color = "#2d7dd2";
	const normalizeHex = (s: string): string => s.trim().toLowerCase();

	let player1Color = $state(defaultPlayer1Color);
	let player2Color = $state(defaultPlayer2Color);
	let isColorInitialized = $state(false);
	let hasReceivedServerColors = $state(false);
	let isComponentOutlinesEnabled = $state(false);
	let isPreviewMode = $state(false);
	let isAltHeld = $state(false);
	let placementTheta = $state(0);

	let sharedOverlay = $state(emptyOverlayState());
	let sharedOverlayVersion = $state(0);
	let sharedPreviewHoldersById = $state<Record<number, true>>({});

	const playerFromIndex = (index: number): Player => {
		return index % 2 === 0 ? 1 : 2;
	};

	type NodeId = number;
	type HistoryMove = { kind: "stone"; stone: StoneData } | { kind: "swap" };
	type MultiPolygon = number[][][][];
	type HistoryNode = {
		id: NodeId;
		parent: NodeId | null;
		move: HistoryMove | null;
		kind: "root" | "stone" | "swap";
		ply: number;
		stonePly: number;
		playersSwapped: boolean;
		children: NodeId[];
		cutoutPolys: MultiPolygon | null;
	};

	type BaselineSnapshot = {
		size: number;
		historyNodes: (HistoryNode | null)[];
		historyRootId: NodeId;
		historyNextId: NodeId;
		realCursorId: NodeId;
	};

	let stagedBaseline: BaselineSnapshot | null = $state(null);
	let hasStagedBaselineChanges = $state(false);

	let historyNodes = $state<(HistoryNode | null)[]>([]);
	let historyRootId = $state<NodeId>(0);
	let historyNextId = $state<NodeId>(1);
	let realCursorId = $state<NodeId>(0);
	let activeKey = $state<StableKey>(rootKey);
	let hoverKey = $state<StableKey | null>(null);
	let lastPreviewKey = $state<StableKey>(rootKey);

	const nodeAt = (id: NodeId): HistoryNode => {
		const n = historyNodes[id];
		if (!n) throw new Error(`missing history node ${id}`);
		return n;
	};

	const resetHistory = (): void => {
		const root: HistoryNode = {
			id: 0,
			parent: null,
			move: null,
			kind: "root",
			ply: 0,
			stonePly: 0,
			playersSwapped: false,
			children: [],
			cutoutPolys: null,
		};
		historyNodes = [];
		historyNodes[0] = root;
		historyRootId = 0;
		historyNextId = 1;
		realCursorId = 0;
		activeKey = rootKey;
		hoverKey = null;
		lastPreviewKey = rootKey;
	};

	resetHistory();

	type Aabb = { x0: number; y0: number; x1: number; y1: number };
	const aabbIntersects = (a: Aabb, b: Aabb): boolean =>
		a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

	const stoneCorners = (stone: StoneData): [number, number][] => {
		const [cx, cy] = stone.coords;
		const h = 1 / 2;
		const c = Math.cos(stone.theta);
		const s = Math.sin(stone.theta);
		const rot = (x: number, y: number): [number, number] => [
			cx + x * c - y * s,
			cy + x * s + y * c,
		];
		return [rot(-h, -h), rot(h, -h), rot(h, h), rot(-h, h)];
	};

	const cornersAt = (theta: number, halfSize: number): [number, number][] => {
		const c = Math.cos(theta);
		const s = Math.sin(theta);
		const rot = (x: number, y: number): [number, number] => [
			x * c - y * s,
			x * s + y * c,
		];
		return [
			rot(-halfSize, -halfSize),
			rot(halfSize, -halfSize),
			rot(halfSize, halfSize),
			rot(-halfSize, halfSize),
		];
	};

	const cross = (
		o: [number, number],
		a: [number, number],
		b: [number, number],
	): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

	const convexHull = (pts: [number, number][]): [number, number][] => {
		const points = pts
			.slice()
			.toSorted((p, q) => (p[0] === q[0] ? p[1] - q[1] : p[0] - q[0]));
		if (points.length <= 1) return points;

		const lower: [number, number][] = [];
		for (const p of points) {
			while (
				lower.length >= 2 &&
				cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0
			)
				lower.pop();
			lower.push(p);
		}

		const upper: [number, number][] = [];
		for (let i = points.length - 1; i >= 0; i--) {
			const p = points[i]!;
			while (
				upper.length >= 2 &&
				cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0
			)
				upper.pop();
			upper.push(p);
		}

		upper.pop();
		lower.pop();
		return lower.concat(upper);
	};

	const shadowHullForStone = (
		stone: StoneData,
		theta: number,
	): [number, number][] => {
		const rPts = stoneCorners(stone);
		const pPts = cornersAt(theta, 1); // 2P: side length 2 (half-size 1)
		const sums: [number, number][] = [];
		for (const a of rPts) {
			for (const b of pPts) sums.push([a[0] + b[0], a[1] + b[1]]);
		}
		return convexHull(sums);
	};

	const pathFromHull = (hull: [number, number][]): string => {
		if (hull.length < 3) return "";
		let d = `M ${hull[0]![0]} ${hull[0]![1]}`;
		for (let i = 1; i < hull.length; i++)
			d += ` L ${hull[i]![0]} ${hull[i]![1]}`;
		d += " Z";
		return d;
	};

	const stoneAabb = (stone: StoneData): Aabb => {
		const pts = stoneCorners(stone);
		let x0 = pts[0]?.[0] ?? 0;
		let y0 = pts[0]?.[1] ?? 0;
		let x1 = x0;
		let y1 = y0;
		for (const [x, y] of pts) {
			x0 = Math.min(x0, x);
			y0 = Math.min(y0, y);
			x1 = Math.max(x1, x);
			y1 = Math.max(y1, y);
		}
		return { x0, y0, x1, y1 };
	};

	const stonePolyAt = (stone: StoneData): MultiPolygon => [
		[stoneCorners(stone)],
	];

	const computeStoneCutoutAt = (
		parentId: NodeId,
		stone: StoneData,
		stoneIndex: number,
	): MultiPolygon => {
		const subject = stonePolyAt(stone);
		const subjectAabb = stoneAabb(stone);
		const player = playerFromIndex(stoneIndex);

		const cuts: MultiPolygon[] = [];
		let cur: NodeId | null = parentId;
		while (cur !== null) {
			const n = nodeAt(cur);
			if (n.move?.kind === "stone") {
				const idx = n.stonePly - 1;
				if (idx >= 0 && playerFromIndex(idx) !== player) {
					const otherStone = n.move.stone;
					const otherAabb = stoneAabb(otherStone);
					if (aabbIntersects(subjectAabb, otherAabb))
						cuts.push(stonePolyAt(otherStone));
				}
			}
			cur = n.parent;
		}

		if (cuts.length === 0) return subject;

		let ok: boolean;
		let result: MultiPolygon | null = null;
		let err: unknown;
		try {
			result = (
				polygonClipping as unknown as {
					difference: (a: MultiPolygon, ...b: MultiPolygon[]) => MultiPolygon;
				}
			).difference(subject, ...cuts);
			ok = true;
		} catch (e) {
			err = e;
			ok = false;
		}
		if (!ok || !result) {
			console.warn("failed to compute stone cutout", err);
			return subject;
		}
		return result;
	};

	const advanceFrom = (fromId: NodeId, stone: StoneData): NodeId => {
		const from = nodeAt(fromId);

		if (isPreviewEnabled && !isSharedPreviewEditEnabled)
			hasStagedBaselineChanges = true;

		const nextId = historyNextId;
		historyNextId += 1;
		const stoneIndex = from.stonePly;
		const next: HistoryNode = {
			id: nextId,
			parent: fromId,
			move: { kind: "stone", stone },
			kind: "stone",
			ply: from.ply + 1,
			stonePly: from.stonePly + 1,
			playersSwapped: from.playersSwapped,
			children: [],
			cutoutPolys: computeStoneCutoutAt(fromId, stone, stoneIndex),
		};

		const updatedFrom: HistoryNode = {
			...from,
			children: [...from.children, nextId],
		};

		const nextNodes = historyNodes.slice();
		nextNodes[nextId] = next;
		nextNodes[fromId] = updatedFrom;
		historyNodes = nextNodes;
		return nextId;
	};

	const advanceSwapFrom = (fromId: NodeId): NodeId => {
		const from = nodeAt(fromId);
		const existing = from.children.find((childId) => {
			const child = nodeAt(childId);
			return child.move?.kind === "swap";
		});
		if (existing !== undefined) return existing;

		if (isPreviewEnabled && !isSharedPreviewEditEnabled)
			hasStagedBaselineChanges = true;

		const nextId = historyNextId;
		historyNextId += 1;
		const next: HistoryNode = {
			id: nextId,
			parent: fromId,
			move: { kind: "swap" },
			kind: "swap",
			ply: from.ply + 1,
			stonePly: from.stonePly,
			playersSwapped: true,
			children: [],
			cutoutPolys: null,
		};

		const updatedFrom: HistoryNode = {
			...from,
			children: [...from.children, nextId],
		};

		const nextNodes = historyNodes.slice();
		nextNodes[nextId] = next;
		nextNodes[fromId] = updatedFrom;
		historyNodes = nextNodes;
		return nextId;
	};

	const moveListAt = (cursorId: NodeId): StoneData[] => {
		let cur = cursorId;
		const out: StoneData[] = [];
		while (cur !== historyRootId) {
			const n = nodeAt(cur);
			if (n.move?.kind === "stone") out.push(n.move.stone);
			if (n.parent === null) break;
			cur = n.parent;
		}
		out.reverse();
		return out;
	};

	const stoneIdsAt = (cursorId: NodeId): NodeId[] => {
		let cur = cursorId;
		const out: NodeId[] = [];
		while (cur !== historyRootId) {
			const n = nodeAt(cur);
			if (n.move?.kind === "stone") out.push(cur);
			if (n.parent === null) break;
			cur = n.parent;
		}
		out.reverse();
		return out;
	};

	const baselineKeyById = $derived(
		((): Record<number, StableKey> => {
			const out: Record<number, StableKey> = {};
			out[historyRootId] = rootKey;

			const stack: NodeId[] = [historyRootId];
			while (stack.length > 0) {
				const id = stack.pop();
				if (id === undefined) break;
				const n = historyNodes[id];
				if (!n) continue;
				const parentKey = out[id];
				if (!parentKey) continue;

				for (const childId of n.children) {
					const child = historyNodes[childId];
					if (!child || !child.move) continue;
					const key = appendKey(parentKey, child.move);
					out[childId] = key;
					stack.push(childId);
				}
			}

			return out;
		})(),
	);

	const baselineIdByKey = $derived(
		((): Record<string, NodeId> => {
			const out: Record<string, NodeId> = {};
			for (const [idStr, key] of Object.entries(baselineKeyById))
				out[key] = Number.parseInt(idStr, 10);
			return out;
		})(),
	);

	const realKey = $derived(baselineKeyById[realCursorId] ?? rootKey);

	const moveForKey = (key: StableKey): HistoryMove | null => {
		if (key === rootKey) return null;

		const baselineId = baselineIdByKey[key];
		if (baselineId !== undefined) return historyNodes[baselineId]?.move ?? null;

		return overlayGet(sharedOverlay, key)?.move ?? null;
	};

	const stoneMovesAtKey = (key: StableKey): StoneData[] => {
		let cur: StableKey = key;
		const out: StoneData[] = [];
		while (cur !== rootKey) {
			const move = moveForKey(cur);
			if (move?.kind === "stone") out.push(move.stone);
			const parent = parentKeyOf(cur);
			if (!parent) break;
			cur = parent;
		}
		out.reverse();
		return out;
	};

	const stonePlyAtKey = (key: StableKey): number => stoneMovesAtKey(key).length;

	const setRealCursor = (next: NodeId): void => {
		realCursorId = next;
		if (playerMode === 1 || !isPreviewMode) {
			activeKey = baselineKeyById[next] ?? rootKey;
			hoverKey = null;
		}
	};

	const setActiveKey = (next: StableKey): void => {
		activeKey = next;
		hoverKey = null;
	};

	const realMoveCount = $derived(nodeAt(realCursorId).stonePly);
	const isPreviewEnabled = $derived(playerMode !== 1 && isPreviewMode);
	const isHistoryClickEnabled = $derived(playerMode === 1 || isPreviewEnabled);
	const isSharedPreviewEditEnabled = $derived(
		isPreviewEnabled && isAltHeld && playerMode !== 1 && connected,
	);
	const isSharedOverlayVisible = $derived(
		playerMode !== 1 &&
			connected &&
			(!isPreviewEnabled || isSharedPreviewEditEnabled),
	);
	const displayKey = $derived(hoverKey ?? activeKey);
	const displayMoves = $derived(
		(() => {
			void sharedOverlayVersion;
			return stoneMovesAtKey(displayKey);
		})(),
	);
	const displayMoveCount = $derived(displayMoves.length);
	const activeMoveCount = $derived(
		(() => {
			void sharedOverlayVersion;
			return stonePlyAtKey(activeKey);
		})(),
	);
	const realPathByKey = $derived(
		(() => {
			const out: Record<string, true> = {};
			let cur: StableKey = realKey;
			while (true) {
				out[cur] = true;
				const parent = parentKeyOf(cur);
				if (parent === null) break;
				cur = parent;
			}
			return out;
		})(),
	);
	const realPathById = $derived(
		(() => {
			const out: Record<number, true> = {};
			let cur = realCursorId;
			while (true) {
				out[cur] = true;
				const parent = nodeAt(cur).parent;
				if (parent === null) break;
				cur = parent;
			}
			return out;
		})(),
	);
	const effectivePlayer = $derived(
		(() => {
			if (assignedPlayer === null) return null;
			const swapped = nodeAt(realCursorId).playersSwapped;
			return swapped ? (assignedPlayer === 1 ? 2 : 1) : assignedPlayer;
		})(),
	);
	let myTurn = $derived(
		playerMode === 1 ||
			(effectivePlayer !== null &&
				playerFromIndex(realMoveCount) === effectivePlayer),
	);
	const isPreviewStoneShown = $derived(
		mouseOver &&
			hoverKey === null &&
			(playerMode === 1 || isPreviewEnabled || (connected && myTurn)),
	);

	$effect(() => {
		moves = moveListAt(realCursorId);
	});

	let realStoneIds = $derived(stoneIdsAt(realCursorId));

	$effect(() => {
		if (!isPreviewEnabled) return;
		lastPreviewKey = activeKey;
	});

	let wasPreviewEnabled = $state(false);
	$effect(() => {
		if (playerMode === 1) {
			isPreviewMode = false;
			lastPreviewKey = realKey;
			activeKey = realKey;
			hoverKey = null;
			wasPreviewEnabled = false;
			stagedBaseline = null;
			hasStagedBaselineChanges = false;
			return;
		}

		if (!isPreviewEnabled) {
			if (wasPreviewEnabled) {
				if (stagedBaseline && hasStagedBaselineChanges) {
					const baseline = stagedBaseline;
					size = baseline.size;
					historyNodes = baseline.historyNodes;
					historyRootId = baseline.historyRootId;
					historyNextId = baseline.historyNextId;
					realCursorId = baseline.realCursorId;
					hoverKey = null;
				}
				stagedBaseline = null;
				hasStagedBaselineChanges = false;
			}
			if (wasPreviewEnabled) lastPreviewKey = activeKey;
			activeKey = realKey;
			hoverKey = null;
		} else if (!wasPreviewEnabled) {
			stagedBaseline = {
				size,
				historyNodes,
				historyRootId,
				historyNextId,
				realCursorId,
			};
			hasStagedBaselineChanges = false;

			const candidate =
				lastPreviewKey in baselineIdByKey ? lastPreviewKey : realKey;
			setActiveKey(candidate);
		}

		wasPreviewEnabled = isPreviewEnabled;
	});

	const setPreviewMode = (next: boolean): void => {
		if (playerMode === 1) return;
		if (!next && isPreviewEnabled) lastPreviewKey = activeKey;
		isPreviewMode = next;
	};

	const hexToRgb = (hex: string): [number, number, number] | null => {
		if (!isValidHexColor(hex)) return null;
		const r = Number.parseInt(hex.slice(1, 3), 16);
		const g = Number.parseInt(hex.slice(3, 5), 16);
		const b = Number.parseInt(hex.slice(5, 7), 16);
		if ([r, g, b].some((v) => Number.isNaN(v))) return null;
		return [r, g, b];
	};

	const rgbCssToRgb = (rgbCss: string): [number, number, number] | null => {
		const match = rgbCss
			.trim()
			.match(/^rgb\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*\)$/);
		if (!match) return null;
		const rStr = match[1];
		const gStr = match[2];
		const bStr = match[3];
		if (!rStr || !gStr || !bStr) return null;
		const r = Number.parseInt(rStr, 10);
		const g = Number.parseInt(gStr, 10);
		const b = Number.parseInt(bStr, 10);
		if ([r, g, b].some((v) => Number.isNaN(v) || v < 0 || v > 255)) return null;
		return [r, g, b];
	};

	const cssColorToRgb = (s: string): [number, number, number] | null => {
		return hexToRgb(s) ?? rgbCssToRgb(s);
	};

	const relativeLuminance = ([r8, g8, b8]: [
		number,
		number,
		number,
	]): number => {
		const toLinear = (v8: number): number => {
			const v = v8 / 255;
			return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
		};
		const r = toLinear(r8);
		const g = toLinear(g8);
		const b = toLinear(b8);
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	};

	const contrastRatio = (l1: number, l2: number): number => {
		const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
		return (hi + 0.05) / (lo + 0.05);
	};

	const readableTextColorOn = (
		backgroundCssColor: string,
	): { fill: "black" | "white"; stroke: "black" | "white" } => {
		const rgb = cssColorToRgb(backgroundCssColor);
		if (!rgb) return { fill: "white", stroke: "black" };

		const bgL = relativeLuminance(rgb);
		const whiteContrast = contrastRatio(1, bgL);
		const blackContrast = contrastRatio(0, bgL);

		return whiteContrast >= blackContrast
			? { fill: "white", stroke: "black" }
			: { fill: "black", stroke: "white" };
	};

	const playerColor = (player: Player): string => {
		switch (player) {
			case 1:
				return player1Color;
			case 2:
				return player2Color;
		}
	};

	let turnPlayer = $derived(playerFromIndex(realMoveCount));
	let turnColor = $derived(playerColor(turnPlayer));
	let turnText = $derived(
		(() => {
			if (playerMode === 1) return `Turn: P${turnPlayer}`;
			if (effectivePlayer === null) return "Turn: —";
			return myTurn ? "Turn: YOURS" : "Turn: THEIRS";
		})(),
	);

	const defaultClockSettings: ClockSettings = {
		enabled: true,
		totalMs: 5 * 60 * 1000,
		gainMs: 0,
	};
	let clockSettings = $state<ClockSettings>(defaultClockSettings);
	let clockStarted = $state(false);
	let clockPaused = $state(false);
	let clockRemainingMsP1 = $state(defaultClockSettings.totalMs);
	let clockRemainingMsP2 = $state(defaultClockSettings.totalMs);
	let clockLastAtMs = $state<number | null>(null);
	let clockUiNowMs = $state<number>(0);

	const resetClock = (settings: ClockSettings): void => {
		clockSettings = settings;
		clockStarted = false;
		clockPaused = false;
		clockRemainingMsP1 = settings.totalMs;
		clockRemainingMsP2 = settings.totalMs;
		clockLastAtMs = null;
		clockUiNowMs = 0;
	};

	const settleClockTo = (activePlayer: Player, atMs: number): void => {
		if (!clockSettings.enabled) return;
		if (!clockStarted) {
			clockLastAtMs = atMs;
			return;
		}
		if (clockPaused) {
			clockLastAtMs = atMs;
			return;
		}
		if (clockLastAtMs === null) {
			clockLastAtMs = atMs;
			return;
		}

		const elapsedMs = atMs - clockLastAtMs;
		if (!isFiniteNumber(elapsedMs) || elapsedMs <= 0) {
			clockLastAtMs = atMs;
			return;
		}

		if (activePlayer === 1) clockRemainingMsP1 -= elapsedMs;
		else clockRemainingMsP2 -= elapsedMs;
		clockLastAtMs = atMs;
	};

	const applyClockTurnTransition = (
		prevTurnPlayer: Player,
		nextTurnPlayer: Player,
		atMs: number,
	): void => {
		if (!clockSettings.enabled) {
			clockLastAtMs = atMs;
			return;
		}
		if (!clockStarted || clockPaused) {
			clockLastAtMs = atMs;
			return;
		}

		if (prevTurnPlayer !== nextTurnPlayer) {
			if (nextTurnPlayer === 1) clockRemainingMsP1 += clockSettings.gainMs;
			else clockRemainingMsP2 += clockSettings.gainMs;
		}
		clockLastAtMs = atMs;
	};

	$effect(() => {
		if (typeof window === "undefined") return;
		if (!clockSettings.enabled) return;
		if (!clockStarted || clockPaused) return;

		clockUiNowMs = Date.now();
		const t = window.setInterval(() => {
			clockUiNowMs = Date.now();
		}, 200);
		return () => window.clearInterval(t);
	});

	const clockDisplayRemainingMsP1 = $derived(
		(() => {
			if (!clockSettings.enabled) return clockRemainingMsP1;
			if (!clockStarted || clockPaused) return clockRemainingMsP1;
			if (turnPlayer !== 1) return clockRemainingMsP1;
			if (clockLastAtMs === null || clockUiNowMs <= 0)
				return clockRemainingMsP1;
			return clockRemainingMsP1 - (clockUiNowMs - clockLastAtMs);
		})(),
	);
	const clockDisplayRemainingMsP2 = $derived(
		(() => {
			if (!clockSettings.enabled) return clockRemainingMsP2;
			if (!clockStarted || clockPaused) return clockRemainingMsP2;
			if (turnPlayer !== 2) return clockRemainingMsP2;
			if (clockLastAtMs === null || clockUiNowMs <= 0)
				return clockRemainingMsP2;
			return clockRemainingMsP2 - (clockUiNowMs - clockLastAtMs);
		})(),
	);

	const setMouseLocFromClient = (clientX: number, clientY: number): void => {
		if (!svg) return;

		const ctm = svg.getScreenCTM();
		if (!ctm) return;

		const p = new DOMPoint(clientX, clientY);
		const { x, y } = p.matrixTransform(ctm.inverse());
		mouseLoc = [x, y];
	};

	let pendingMouseClient: [number, number] | null = $state(null);
	let isMouseLocUpdateScheduled = $state(false);

	let svgPixels = $state<{ w: number; h: number } | null>(null);
	$effect(() => {
		if (typeof window === "undefined") return;
		if (!svg) return;

		const update = () => {
			const rect = svg.getBoundingClientRect();
			svgPixels = { w: rect.width, h: rect.height };
		};

		const ro = new ResizeObserver(update);
		ro.observe(svg);
		queueMicrotask(update);
		return () => ro.disconnect();
	});

	const scheduleMouseLocUpdate = (
		clientX: number,
		clientY: number,
		force: boolean,
	): void => {
		lastClientCoords = [clientX, clientY];
		pendingMouseClient = [clientX, clientY];

		if (isMouseLocUpdateScheduled) return;
		isMouseLocUpdateScheduled = true;

		requestAnimationFrame(() => {
			isMouseLocUpdateScheduled = false;
			const pending = pendingMouseClient;
			pendingMouseClient = null;
			if (!pending) return;

			const shouldUpdate =
				force ||
				panSession !== null ||
				(mouseOver && (playerMode === 1 || isPreviewEnabled || myTurn));
			if (!shouldUpdate) return;

			const [x, y] = pending;
			setMouseLocFromClient(x, y);
		});
	};

	const updateMouseLoc = (e: PointerEvent | WheelEvent): void => {
		scheduleMouseLocUpdate(e.clientX, e.clientY, false);
	};

	const updateMouseLocImmediately = (e: PointerEvent | WheelEvent): void => {
		lastClientCoords = [e.clientX, e.clientY];
		pendingMouseClient = [e.clientX, e.clientY];
		setMouseLocFromClient(e.clientX, e.clientY);
	};

	const clampViewBox = (next: ViewBox): ViewBox => {
		const w = clamp(next.w, minViewBoxSize, size);
		const h = clamp(next.h, minViewBoxSize, size);
		return {
			x: clamp(next.x, 0, size - w),
			y: clamp(next.y, 0, size - h),
			w,
			h,
		};
	};

	const applyBoardSize = (next: number): void => {
		const clamped = clamp(Math.round(next), minBoardSize, maxBoardSize);
		if (clamped === size) return;

		size = clamped;
		resetHistory();
		if (playerMode !== 1 && connected)
			send(playerMode.socket, { type: "set size", data: size });
	};

	type PanSession = {
		startClient: [number, number];
		startViewBox: ViewBox;
		unitsPerPixelX: number;
		unitsPerPixelY: number;
	};
	let panSession: PanSession | null = $state(null);
	let pendingPanClient: [number, number] | null = $state(null);
	let isPanUpdateScheduled = $state(false);

	const schedulePanUpdate = (clientX: number, clientY: number): void => {
		if (!panSession) return;
		pendingPanClient = [clientX, clientY];

		if (isPanUpdateScheduled) return;
		isPanUpdateScheduled = true;

		requestAnimationFrame(() => {
			isPanUpdateScheduled = false;
			const pending = pendingPanClient;
			pendingPanClient = null;
			if (!pending) return;

			const session = panSession;
			if (!session) return;

			const [startClientX, startClientY] = session.startClient;
			const dx = pending[0] - startClientX;
			const dy = pending[1] - startClientY;

			viewBox = clampViewBox({
				...session.startViewBox,
				x: session.startViewBox.x - dx * session.unitsPerPixelX,
				y: session.startViewBox.y - dy * session.unitsPerPixelY,
			});
		});
	};

	$effect(() => {
		if (viewBox.w === 0 && viewBox.h === 0) {
			viewBox = { x: 0, y: 0, w: size, h: size };
			lastSize = size;
			return;
		}

		if (size !== lastSize) {
			viewBox = { x: 0, y: 0, w: size, h: size };
			lastSize = size;
		}
	});

	let isShiftHeld = $state(false);
	let boardShotCopyState = $state<"idle" | "copied" | "failed">("idle");
	let boardShotCopyToken = $state(0);
	$effect(() => {
		if (typeof window === "undefined") return;

		const syncHover = () => {
			if (!svg) return;

			const isHoveredNow = svg.matches(":hover");
			if (!isHoveredNow) {
				mouseOver = false;
				return;
			}

			mouseOver = true;
			if (lastClientCoords) {
				const [clientX, clientY] = lastClientCoords;
				setMouseLocFromClient(clientX, clientY);
			}
		};

		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "z" && e.ctrlKey) {
				const target = e.target;
				const isFormTarget =
					target instanceof HTMLInputElement ||
					target instanceof HTMLTextAreaElement ||
					target instanceof HTMLSelectElement;
				if (isFormTarget) return;

				e.preventDefault();
				if (playerMode === 1) {
					undoReal();
					return;
				}

				if (isPreviewEnabled) {
					undoActive();
					return;
				}

				if (connected) {
					undoReal();
					send(playerMode.socket, { type: "undo" });
				}
				return;
			}

			if (e.key === "Shift") isShiftHeld = true;
			if (e.key === "Control") {
				const target = e.target;
				const isFormTarget =
					target instanceof HTMLInputElement ||
					target instanceof HTMLTextAreaElement ||
					target instanceof HTMLSelectElement;
				if (isFormTarget) return;
				setPreviewMode(true);
			}
			if (e.key === "Alt") {
				const target = e.target;
				const isFormTarget =
					target instanceof HTMLInputElement ||
					target instanceof HTMLTextAreaElement ||
					target instanceof HTMLSelectElement;
				if (isFormTarget) return;
				isAltHeld = true;
			}
		};
		const onKeyUp = (e: KeyboardEvent) => {
			if (e.key === "Shift") isShiftHeld = false;
			if (e.key === "Control") setPreviewMode(false);
			if (e.key === "Alt") isAltHeld = false;
		};
		const onBlur = () => {
			isShiftHeld = false;
			setPreviewMode(false);
			isAltHeld = false;
		};
		const onFocus = () => {
			syncHover();
		};
		const onVisibilityChange = () => {
			if (!document.hidden) syncHover();
		};
		const onWindowPointerMove = (e: PointerEvent) => {
			lastClientCoords = [e.clientX, e.clientY];
			if (!svg) return;
			if (!svg.matches(":hover")) return;
			mouseOver = true;
			updateMouseLoc(e);
		};

		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("keyup", onKeyUp);
		window.addEventListener("blur", onBlur);
		window.addEventListener("focus", onFocus);
		document.addEventListener("visibilitychange", onVisibilityChange);
		window.addEventListener("pointermove", onWindowPointerMove);

		queueMicrotask(syncHover);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("keyup", onKeyUp);
			window.removeEventListener("blur", onBlur);
			window.removeEventListener("focus", onFocus);
			document.removeEventListener("visibilitychange", onVisibilityChange);
			window.removeEventListener("pointermove", onWindowPointerMove);
		};
	});

	const showBoardShotCopyState = (next: "copied" | "failed"): void => {
		boardShotCopyState = next;
		boardShotCopyToken += 1;
		const token = boardShotCopyToken;
		window.setTimeout(() => {
			if (boardShotCopyToken !== token) return;
			boardShotCopyState = "idle";
		}, 1200);
	};

	const loadImageFromUrl = (url: string): Promise<HTMLImageElement> =>
		new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => resolve(img);
			img.onerror = (e) => reject(e);
			img.src = url;
		});

	const copyBoardShot = async (): Promise<void> => {
		if (typeof window === "undefined") return;
		if (!svg) return;
		if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
			showBoardShotCopyState("failed");
			return;
		}

		const rect = svg.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) {
			showBoardShotCopyState("failed");
			return;
		}

		const dpr = window.devicePixelRatio || 1;
		const wPx = Math.round(rect.width * dpr);
		const hPx = Math.round(rect.height * dpr);

		const style = window.getComputedStyle(svg);
		const borderPx =
			Math.max(0, Number.parseFloat(style.borderTopWidth) || 0) * dpr;

		const canvas = document.createElement("canvas");
		canvas.width = wPx;
		canvas.height = hPx;
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			showBoardShotCopyState("failed");
			return;
		}

		const bg = ctx.createLinearGradient(0, 0, 0, hPx);
		bg.addColorStop(0, "#f3efe6");
		bg.addColorStop(1, "#e8e1d5");
		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, wPx, hPx);

		const radial = ctx.createRadialGradient(
			wPx * 0.2,
			hPx * 0.18,
			0,
			wPx * 0.2,
			hPx * 0.18,
			Math.max(wPx, hPx) * 0.7,
		);
		radial.addColorStop(0, "rgba(255,255,255,0.75)");
		radial.addColorStop(0.6, "rgba(255,255,255,0)");
		ctx.fillStyle = radial;
		ctx.fillRect(0, 0, wPx, hPx);

		if (borderPx > 0) {
			ctx.fillStyle = style.borderTopColor;
			ctx.fillRect(0, 0, wPx, borderPx);
			ctx.fillStyle = style.borderBottomColor;
			ctx.fillRect(0, hPx - borderPx, wPx, borderPx);
			ctx.fillStyle = style.borderLeftColor;
			ctx.fillRect(0, 0, borderPx, hPx);
			ctx.fillStyle = style.borderRightColor;
			ctx.fillRect(wPx - borderPx, 0, borderPx, hPx);
		}

		const serializer = new XMLSerializer();
		const rawSvg = serializer.serializeToString(svg);
		const svgText = rawSvg.includes('xmlns="http://www.w3.org/2000/svg"')
			? rawSvg
			: rawSvg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
		const svgBlob = new Blob([svgText], {
			type: "image/svg+xml;charset=utf-8",
		});
		const url = URL.createObjectURL(svgBlob);

		let ok: boolean;
		let err: unknown;
		let img: HTMLImageElement | null = null;
		try {
			img = await loadImageFromUrl(url);
			ok = true;
		} catch (e) {
			err = e;
			ok = false;
		} finally {
			URL.revokeObjectURL(url);
		}

		if (!ok || !img) {
			console.warn("failed to render svg", err);
			showBoardShotCopyState("failed");
			return;
		}

		const innerW = wPx - borderPx * 2;
		const innerH = hPx - borderPx * 2;
		ctx.drawImage(img, borderPx, borderPx, innerW, innerH);

		let ok2: boolean;
		let err2: unknown;
		let pngBlob: Blob | null = null;
		try {
			pngBlob = await new Promise<Blob | null>((resolve) =>
				canvas.toBlob(resolve, "image/png"),
			);
			ok2 = true;
		} catch (e) {
			err2 = e;
			ok2 = false;
		}
		if (!ok2 || !pngBlob) {
			console.warn("failed to create png", err2);
			showBoardShotCopyState("failed");
			return;
		}

		let ok3: boolean;
		let err3: unknown;
		try {
			await navigator.clipboard.write([
				new ClipboardItem({ "image/png": pngBlob }),
			]);
			ok3 = true;
		} catch (e) {
			err3 = e;
			ok3 = false;
		}

		if (!ok3) {
			console.warn("failed to write clipboard", err3);
			showBoardShotCopyState("failed");
			return;
		}

		showBoardShotCopyState("copied");
	};

	const colorStorageKeyP1 = "continuous-connection-game.color.p1";
	const colorStorageKeyP2 = "continuous-connection-game.color.p2";
	const gameStateStorageKey = $derived(
		playerMode === 1
			? "continuous-connection-game.state.local"
			: `continuous-connection-game.state.ws.${encodeURIComponent(wsUrl.trim())}`,
	);
	let isUsingDefaultColors = $derived(
		normalizeHex(player1Color) === normalizeHex(defaultPlayer1Color) &&
			normalizeHex(player2Color) === normalizeHex(defaultPlayer2Color),
	);

	const isNodeId = (u: unknown): u is NodeId =>
		isFiniteNumber(u) && Number.isInteger(u) && u >= 0;

	const isHistoryMove = (u: unknown): u is HistoryMove => {
		if (typeof u !== "object" || u === null) return false;
		if (!("kind" in u)) return false;

		const kind = (u as HistoryMove).kind;
		switch (kind) {
			case "stone":
				return (
					"stone" in u &&
					isStoneData((u as { kind: "stone"; stone: unknown }).stone)
				);
			case "swap":
				return true;
			default:
				return false;
		}
	};

	const isPoint = (u: unknown): u is [number, number] =>
		Array.isArray(u) &&
		u.length === 2 &&
		isFiniteNumber(u[0]) &&
		isFiniteNumber(u[1]);

	const isMultiPolygon = (u: unknown): u is MultiPolygon =>
		Array.isArray(u) &&
		u.every(
			(poly) =>
				Array.isArray(poly) &&
				poly.every(
					(ring) =>
						Array.isArray(ring) && ring.length >= 3 && ring.every(isPoint),
				),
		);

	const isHistoryNode = (u: unknown): u is HistoryNode => {
		if (typeof u !== "object" || u === null) return false;
		if (!("id" in u) || !isNodeId((u as HistoryNode).id)) return false;
		if (!("parent" in u)) return false;
		const parent = (u as HistoryNode).parent;
		if (parent !== null && !isNodeId(parent)) return false;
		if (!("move" in u)) return false;
		const move = (u as HistoryNode).move;
		if (move !== null && !isHistoryMove(move)) return false;
		if (!("kind" in u)) return false;
		const kind = (u as HistoryNode).kind;
		if (kind !== "root" && kind !== "stone" && kind !== "swap") return false;
		if (!("ply" in u) || !isNodeId((u as HistoryNode).ply)) return false;
		if (!("stonePly" in u) || !isNodeId((u as HistoryNode).stonePly))
			return false;
		if (
			!("playersSwapped" in u) ||
			typeof (u as HistoryNode).playersSwapped !== "boolean"
		)
			return false;
		if (!("children" in u) || !Array.isArray((u as HistoryNode).children))
			return false;
		if (!(u as HistoryNode).children.every(isNodeId)) return false;
		if ("cutoutPolys" in u) {
			const cr = (u as { cutoutPolys: unknown }).cutoutPolys;
			if (cr !== null && !isMultiPolygon(cr)) return false;
		}
		return true;
	};

	type PersistedStateV3 = {
		v: 3;
		size: number;
		historyNodes: (HistoryNode | null)[];
		historyRootId: NodeId;
		historyNextId: NodeId;
		realCursorId: NodeId;

		clockSettings: ClockSettings;
		clockStarted: boolean;
		clockPaused: boolean;
		clockRemainingMsP1: number;
		clockRemainingMsP2: number;
	};

	type PersistedStateV1Legacy = {
		v: 1;
		size: number;
		historyNodes: (HistoryNode | null)[];
		historyRootId: NodeId;
		historyNextId: NodeId;
		realCursorId: NodeId;
		activeCursorId: NodeId;
		lastPreviewCursorId: NodeId;
	};

	type PersistedStateV2Legacy = {
		v: 2;
		size: number;
		historyNodes: (HistoryNode | null)[];
		historyRootId: NodeId;
		historyNextId: NodeId;
		realCursorId: NodeId;
	};

	let loadedPersistedStateKey: string | null = $state(null);
	let hasSettledPersistedStateLoad = $state(false);
	let lastPersistedGameStateJson = $state<string | null>(null);
	$effect(() => {
		if (typeof window === "undefined") return;
		if (
			loadedPersistedStateKey === gameStateStorageKey &&
			hasSettledPersistedStateLoad
		)
			return;

		loadedPersistedStateKey = gameStateStorageKey;
		hasSettledPersistedStateLoad = false;

		const root = historyNodes[historyRootId];
		const isFresh =
			!!root &&
			root.kind === "root" &&
			root.children.length === 0 &&
			historyNextId === 1 &&
			realCursorId === historyRootId;
		if (!isFresh) {
			hasSettledPersistedStateLoad = true;
			return;
		}

		let ok: boolean;
		let err: unknown;
		let raw: string | null = null;
		try {
			raw = localStorage.getItem(gameStateStorageKey);
			ok = true;
		} catch (e) {
			err = e;
			ok = false;
		}
		if (!ok) {
			console.warn("failed to read persisted game state", err);
			hasSettledPersistedStateLoad = true;
			return;
		}
		if (!raw) {
			hasSettledPersistedStateLoad = true;
			return;
		}

		let ok2: boolean;
		let err2: unknown;
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
			ok2 = true;
		} catch (e) {
			err2 = e;
			ok2 = false;
		}
		if (!ok2) {
			console.warn("persisted game state JSON did not parse", err2);
			hasSettledPersistedStateLoad = true;
			return;
		}
		if (typeof parsed !== "object" || parsed === null) {
			hasSettledPersistedStateLoad = true;
			return;
		}
		if (!("v" in parsed)) {
			hasSettledPersistedStateLoad = true;
			return;
		}

		const v = (parsed as { v: unknown }).v;
		if (v !== 1 && v !== 2 && v !== 3) {
			hasSettledPersistedStateLoad = true;
			return;
		}

		let typed: PersistedStateV3;
		if (v === 3) {
			typed = parsed as PersistedStateV3;
		} else if (v === 2) {
			const legacy2 = parsed as PersistedStateV2Legacy;
			typed = {
				v: 3,
				size: legacy2.size,
				historyNodes: legacy2.historyNodes,
				historyRootId: legacy2.historyRootId,
				historyNextId: legacy2.historyNextId,
				realCursorId: legacy2.realCursorId,
				clockSettings: defaultClockSettings,
				clockStarted: false,
				clockPaused: false,
				clockRemainingMsP1: defaultClockSettings.totalMs,
				clockRemainingMsP2: defaultClockSettings.totalMs,
			};
		} else {
			const legacy = parsed as PersistedStateV1Legacy;
			if (
				!isNodeId(legacy.activeCursorId) ||
				!isNodeId(legacy.lastPreviewCursorId)
			) {
				hasSettledPersistedStateLoad = true;
				return;
			}
			typed = {
				v: 3,
				size: legacy.size,
				historyNodes: legacy.historyNodes,
				historyRootId: legacy.historyRootId,
				historyNextId: legacy.historyNextId,
				realCursorId: legacy.realCursorId,
				clockSettings: defaultClockSettings,
				clockStarted: false,
				clockPaused: false,
				clockRemainingMsP1: defaultClockSettings.totalMs,
				clockRemainingMsP2: defaultClockSettings.totalMs,
			};
		}
		if (!isValidBoardSize(typed.size)) {
			hasSettledPersistedStateLoad = true;
			return;
		}
		if (!Array.isArray(typed.historyNodes)) {
			hasSettledPersistedStateLoad = true;
			return;
		}
		if (!isNodeId(typed.historyRootId)) {
			hasSettledPersistedStateLoad = true;
			return;
		}
		if (!isNodeId(typed.historyNextId)) {
			hasSettledPersistedStateLoad = true;
			return;
		}
		if (!isNodeId(typed.realCursorId)) {
			hasSettledPersistedStateLoad = true;
			return;
		}
		if (
			typeof typed.clockSettings !== "object" ||
			typed.clockSettings === null ||
			!isFiniteNumber(typed.clockSettings.totalMs) ||
			!isFiniteNumber(typed.clockSettings.gainMs) ||
			typed.clockSettings.totalMs < 0 ||
			typed.clockSettings.gainMs < 0
		) {
			hasSettledPersistedStateLoad = true;
			return;
		}
		if (
			typeof typed.clockStarted !== "boolean" ||
			typeof typed.clockPaused !== "boolean" ||
			!isFiniteNumber(typed.clockRemainingMsP1) ||
			!isFiniteNumber(typed.clockRemainingMsP2)
		) {
			hasSettledPersistedStateLoad = true;
			return;
		}

		const nodes = typed.historyNodes;
		if (nodes.length === 0) {
			hasSettledPersistedStateLoad = true;
			return;
		}
		if (!nodes.every((n) => n === null || isHistoryNode(n))) {
			hasSettledPersistedStateLoad = true;
			return;
		}
		if (typed.historyRootId !== 0) {
			hasSettledPersistedStateLoad = true;
			return;
		}
		if (!nodes[0] || nodes[0].kind !== "root") {
			hasSettledPersistedStateLoad = true;
			return;
		}

		const hasNodeAt = (id: NodeId): boolean => !!nodes[id];
		if (!hasNodeAt(typed.realCursorId)) {
			hasSettledPersistedStateLoad = true;
			return;
		}

		size = typed.size;

		const normalizedNodes: (HistoryNode | null)[] = nodes.map((n) => {
			if (!n) return null;
			if ("cutoutPolys" in n) return n as HistoryNode;
			return { ...(n as HistoryNode), cutoutPolys: null };
		});

		historyNodes = normalizedNodes;

		const withCutouts: (HistoryNode | null)[] = normalizedNodes.map((n) => {
			if (!n) return null;
			if (n.move?.kind !== "stone") return n;
			if (n.cutoutPolys) return n;
			if (n.parent === null) return n;
			const stoneIndex = n.stonePly - 1;
			if (stoneIndex < 0) return n;
			return {
				...n,
				cutoutPolys: computeStoneCutoutAt(n.parent, n.move.stone, stoneIndex),
			};
		});
		historyNodes = withCutouts;
		historyRootId = typed.historyRootId;
		historyNextId = typed.historyNextId;
		realCursorId = typed.realCursorId;
		hoverKey = null;
		lastPreviewKey = rootKey;
		clockSettings = typed.clockSettings;
		clockStarted = typed.clockStarted;
		clockPaused = typed.clockPaused;
		clockRemainingMsP1 = typed.clockRemainingMsP1;
		clockRemainingMsP2 = typed.clockRemainingMsP2;
		if (typed.clockStarted && !typed.clockPaused) {
			const now = Date.now();
			clockLastAtMs = now;
			clockUiNowMs = now;
		} else {
			clockLastAtMs = null;
			clockUiNowMs = 0;
		}

		lastPersistedGameStateJson = raw;
		hasSettledPersistedStateLoad = true;
	});

	const persistGameStateSnapshot = (): PersistedStateV3 => ({
		v: 3,
		size,
		historyNodes:
			isPreviewEnabled && stagedBaseline
				? stagedBaseline.historyNodes
				: historyNodes,
		historyRootId:
			isPreviewEnabled && stagedBaseline
				? stagedBaseline.historyRootId
				: historyRootId,
		historyNextId:
			isPreviewEnabled && stagedBaseline
				? stagedBaseline.historyNextId
				: historyNextId,
		realCursorId:
			isPreviewEnabled && stagedBaseline
				? stagedBaseline.realCursorId
				: realCursorId,

		clockSettings,
		clockStarted,
		clockPaused,
		clockRemainingMsP1,
		clockRemainingMsP2,
	});

	let persistGameStateTimer: number | null = null;
	let persistGameStateIdleHandle: number | null = null;
	let persistGameStateToken = 0;

	const clearPersistSchedule = (): void => {
		if (persistGameStateTimer !== null) {
			window.clearTimeout(persistGameStateTimer);
			persistGameStateTimer = null;
		}

		if (persistGameStateIdleHandle !== null && "cancelIdleCallback" in window) {
			(
				window as unknown as { cancelIdleCallback: (h: number) => void }
			).cancelIdleCallback(persistGameStateIdleHandle);
			persistGameStateIdleHandle = null;
		}
	};

	const flushPersistedGameState = (): void => {
		clearPersistSchedule();

		const atMs = Date.now();
		settleClockTo(turnPlayer, atMs);
		clockLastAtMs = atMs;

		const key = gameStateStorageKey;
		const snapshot = persistGameStateSnapshot();

		let ok: boolean;
		let err: unknown;
		let json: string | null = null;
		try {
			json = JSON.stringify(snapshot);
			ok = true;
		} catch (e) {
			err = e;
			ok = false;
		}
		if (!ok || json === null) {
			console.warn("failed to stringify persisted game state", err);
			return;
		}

		if (lastPersistedGameStateJson === json) return;

		let ok2: boolean;
		let err2: unknown;
		try {
			localStorage.setItem(key, json);
			ok2 = true;
		} catch (e) {
			err2 = e;
			ok2 = false;
		}
		if (!ok2) {
			console.warn("failed to persist game state", err2);
			return;
		}

		lastPersistedGameStateJson = json;
	};

	const schedulePersistedGameState = (): void => {
		persistGameStateToken += 1;
		const token = persistGameStateToken;

		if (persistGameStateTimer !== null || persistGameStateIdleHandle !== null)
			return;

		const scheduleFallback = () => {
			persistGameStateTimer = window.setTimeout(() => {
				persistGameStateTimer = null;
				if (persistGameStateToken !== token) schedulePersistedGameState();
				else flushPersistedGameState();
			}, 900);
		};

		if (!("requestIdleCallback" in window)) {
			scheduleFallback();
			return;
		}

		persistGameStateIdleHandle = (
			window as unknown as {
				requestIdleCallback: (
					cb: () => void,
					opts: { timeout: number },
				) => number;
			}
		).requestIdleCallback(
			() => {
				persistGameStateIdleHandle = null;
				if (persistGameStateToken !== token) schedulePersistedGameState();
				else flushPersistedGameState();
			},
			{ timeout: 1200 },
		);
	};

	$effect(() => {
		if (typeof window === "undefined") return;
		if (!hasSettledPersistedStateLoad) return;
		void gameStateStorageKey;
		void size;
		void historyNodes;
		void historyRootId;
		void historyNextId;
		void realCursorId;
		void clockSettings;
		void clockStarted;
		void clockPaused;
		void clockRemainingMsP1;
		void clockRemainingMsP2;
		schedulePersistedGameState();
	});

	$effect(() => {
		if (typeof window === "undefined") return;

		const onVisibilityChange = () => {
			if (!document.hidden) return;
			flushPersistedGameState();
		};

		const onBeforeUnload = () => {
			flushPersistedGameState();
		};

		document.addEventListener("visibilitychange", onVisibilityChange);
		window.addEventListener("beforeunload", onBeforeUnload);
		return () => {
			document.removeEventListener("visibilitychange", onVisibilityChange);
			window.removeEventListener("beforeunload", onBeforeUnload);
		};
	});

	$effect(() => {
		if (typeof window === "undefined") return;
		return () => clearPersistSchedule();
	});

	const newGame = (): void => {
		resetHistory();
		viewBox = { x: 0, y: 0, w: size, h: size };
		isPreviewMode = false;
		stagedBaseline = null;
		hasStagedBaselineChanges = false;
		sharedOverlay = emptyOverlayState();
		sharedOverlayVersion += 1;
		sharedPreviewHoldersById = {};
		lastPersistedGameStateJson = null;

		if (typeof window === "undefined") return;
		clearPersistSchedule();
		let ok: boolean;
		let err: unknown;
		try {
			localStorage.removeItem(gameStateStorageKey);
			ok = true;
		} catch (e) {
			err = e;
			ok = false;
		}
		if (!ok) console.warn("failed to clear persisted game state", err);
	};

	const snapshotBaseline = (): BaselineSnapshot => ({
		size,
		historyNodes,
		historyRootId,
		historyNextId,
		realCursorId,
	});

	const saveLocalStagedPreview = (): void => {
		if (!isPreviewEnabled) return;
		if (!stagedBaseline) return;
		if (!hasStagedBaselineChanges) return;

		stagedBaseline = snapshotBaseline();
		hasStagedBaselineChanges = false;
		flushPersistedGameState();
	};

	const overlaySubtreeRootedAt = (root: StableKey): StableKey[] => {
		const out: StableKey[] = [];

		if (overlayGet(sharedOverlay, root)) {
			out.push(...overlaySubtreeKeys(sharedOverlay, root));
			return out;
		}

		const roots = sharedOverlay.childrenByParentKey.get(root) ?? [];
		for (const k of roots) out.push(...overlaySubtreeKeys(sharedOverlay, k));
		return out;
	};

	const importSharedOverlaySubtree = (root: StableKey): void => {
		const subtreeKeys = overlaySubtreeRootedAt(root);
		if (subtreeKeys.length === 0) return;

		const idByKey: Record<string, NodeId> = { ...baselineIdByKey };
		const toImport = subtreeKeys.toSorted(
			(a, b) => keyDepth(a) - keyDepth(b) || a.localeCompare(b),
		);

		for (const key of toImport) {
			if (key in idByKey) continue;
			const node = overlayGet(sharedOverlay, key);
			if (!node) continue;

			const parentKey = node.parentKey;
			const parentId = idByKey[parentKey];
			if (parentId === undefined) continue;

			switch (node.move.kind) {
				case "stone":
					idByKey[appendKey(parentKey, node.move)] = advanceFrom(
						parentId,
						node.move.stone,
					);
					break;
				case "swap":
					idByKey[appendKey(parentKey, node.move)] = advanceSwapFrom(parentId);
					break;
				default:
					ensureCoverage(node.move);
			}
		}

		if (isPreviewEnabled && stagedBaseline) {
			stagedBaseline = snapshotBaseline();
			hasStagedBaselineChanges = false;
		}

		flushPersistedGameState();
	};

	$effect(() => {
		if (typeof window === "undefined") return;
		if (isColorInitialized) return;

		let storedP1: string | null = null;
		let storedP2: string | null = null;
		try {
			storedP1 = localStorage.getItem(colorStorageKeyP1);
		} catch {}
		try {
			storedP2 = localStorage.getItem(colorStorageKeyP2);
		} catch {}

		if (storedP1 && isValidHexColor(storedP1)) player1Color = storedP1;
		if (storedP2 && isValidHexColor(storedP2)) player2Color = storedP2;
		isColorInitialized = true;
	});

	$effect(() => {
		if (typeof window === "undefined") return;
		if (!isColorInitialized) return;

		try {
			localStorage.setItem(colorStorageKeyP1, player1Color);
		} catch {}
		try {
			localStorage.setItem(colorStorageKeyP2, player2Color);
		} catch {}
	});

	const commitColors = (): void => {
		if (playerMode !== 1 && connected)
			send(playerMode.socket, {
				type: "set colors",
				data: { p1: player1Color, p2: player2Color },
			});
	};

	const resetColors = (): void => {
		player1Color = defaultPlayer1Color;
		player2Color = defaultPlayer2Color;
		isColorInitialized = true;
		commitColors();
	};

	const isStableKey = (u: unknown): u is StableKey =>
		typeof u === "string" && u.trim().length > 0;

	const isSharedPreviewOp = (u: unknown): u is SharedPreviewOp => {
		if (typeof u !== "object" || u === null) return false;
		if (!("kind" in u)) return false;

		const typed = u as { kind: unknown; [k: string]: unknown };
		if (typeof typed.kind !== "string") return false;

		const isSharedPreviewMove = (m: unknown): boolean => {
			if (typeof m !== "object" || m === null) return false;
			if (!("kind" in m)) return false;
			const mk = (m as { kind: unknown }).kind;
			if (mk === "swap") return true;
			if (mk === "stone")
				return "stone" in m && isStoneData((m as { stone: unknown }).stone);
			return false;
		};

		switch (typed.kind) {
			case "presence":
				return typeof typed["active"] === "boolean";
			case "add":
				return (
					isStableKey(typed["parentKey"]) &&
					"move" in typed &&
					isSharedPreviewMove(typed["move"])
				);
			case "delete":
				return isStableKey(typed["rootKey"]);
			default:
				return false;
		}
	};

	const isSharedPreviewServerData = (
		u: unknown,
	): u is { senderId: number; op: SharedPreviewOp } => {
		if (typeof u !== "object" || u === null) return false;
		if (!("senderId" in u) || !("op" in u)) return false;
		const senderId = (u as { senderId: unknown }).senderId;
		if (
			!isFiniteNumber(senderId) ||
			!Number.isInteger(senderId) ||
			senderId < 0
		)
			return false;
		return isSharedPreviewOp((u as { op: unknown }).op);
	};

	const parseWs = (data: string): ServerMessage | Bad => {
		let ok: boolean;
		let parsed: unknown;
		let err: unknown;
		try {
			parsed = JSON.parse(data);
			ok = true;
		} catch (e) {
			err = e;
			ok = false;
		}

		if (!ok) return new Bad(`JSON did not parse: ${String(err)}`);
		if (typeof parsed !== "object" || parsed === null)
			return new Bad("ServerMessage must be an object");
		if (!("type" in parsed)) return new Bad("ServerMessage missing type");

		const typed = parsed as ServerMessage;
		switch (typed.type) {
			case "move":
				if (
					typeof typed.data === "object" &&
					typed.data !== null &&
					"senderId" in typed.data &&
					"move" in typed.data &&
					isFiniteNumber((typed.data as { senderId: unknown }).senderId) &&
					Number.isInteger((typed.data as { senderId: unknown }).senderId) &&
					(typed.data as { senderId: number }).senderId >= 0 &&
					isTimedMoveData((typed.data as { move: unknown }).move)
				)
					return typed;
				else return new Bad("'move' type has incorrect data");
			case "set size":
				if (isValidBoardSize(typed.data)) return typed;
				else return new Bad("'set size' type has incorrect data");
			case "set colors":
				if (isBoardColors(typed.data)) return typed;
				else return new Bad("'set colors' type has incorrect data");
			case "assign id":
				if (
					isFiniteNumber(typed.data) &&
					Number.isInteger(typed.data) &&
					typed.data >= 0
				)
					return typed;
				else return new Bad("'assign id' type has incorrect data");
			case "assign player":
				if (typed.data === 1 || typed.data === 2) return typed;
				else return new Bad("'assign player' type has incorrect data");
			case "full":
				return typed;
			case "undo":
			case "swap":
				if (isStampedOp(typed.data)) return typed;
				else return new Bad(`'${typed.type}' type has incorrect data`);
			case "clock":
				if (
					typeof typed.data === "object" &&
					typed.data !== null &&
					"senderId" in typed.data &&
					"atMs" in typed.data &&
					"op" in typed.data &&
					isFiniteNumber((typed.data as { senderId: unknown }).senderId) &&
					Number.isInteger((typed.data as { senderId: unknown }).senderId) &&
					(typed.data as { senderId: number }).senderId >= 0 &&
					isFiniteNumber((typed.data as { atMs: unknown }).atMs) &&
					isClockOp((typed.data as { op: unknown }).op)
				)
					return typed;
				else return new Bad("'clock' type has incorrect data");
			case "shared preview":
				if (isSharedPreviewServerData(typed.data)) return typed;
				else return new Bad("'shared preview' type has incorrect data");
			default:
				ensureCoverage(typed);
				return new Bad("ServerMessage.type is invalid");
		}
	};

	const send = (ws: WebSocket, message: InnerClientMessage): void => {
		if (id !== null) ws.send(JSON.stringify({ id, message }));
		else console.error("id is null");
	};

	let wasSharedPresenceActive = $state(false);
	$effect(() => {
		if (playerMode === 1) {
			wasSharedPresenceActive = false;
			return;
		}
		if (!connected) {
			wasSharedPresenceActive = false;
			return;
		}

		const now = isSharedPreviewEditEnabled;
		if (now === wasSharedPresenceActive) return;
		wasSharedPresenceActive = now;
		send(playerMode.socket, {
			type: "shared preview",
			data: { kind: "presence", active: now },
		});
	});

	let hasSentInitialSize = $state(false);
	let hasSentInitialColors = $state(false);

	$effect(() => {
		if (playerMode === 1) return;

		hasSentInitialSize = false;
		hasSentInitialColors = false;
		hasReceivedServerColors = false;
		const ws = playerMode.socket;

		const onOpen = () => {
			connected = true;
			if (id !== null && !hasSentInitialSize) {
				send(ws, { type: "set size", data: size });
				hasSentInitialSize = true;
			}
			if (id !== null && !hasSentInitialColors && !hasReceivedServerColors) {
				send(ws, {
					type: "set colors",
					data: { p1: player1Color, p2: player2Color },
				});
				hasSentInitialColors = true;
			}
		};

		const onMessage = (e: MessageEvent) => {
			const result = parseWs(e.data);
			Bad.handle(
				result,
				(msg) => {
					switch (msg.type) {
						case "move":
							{
								const prevMoveCount =
									id === msg.data.senderId
										? Math.max(0, realMoveCount - 1)
										: realMoveCount;
								const prevTurn = playerFromIndex(prevMoveCount);
								settleClockTo(prevTurn, msg.data.move.atMs);

								if (id !== msg.data.senderId)
									setRealCursor(advanceFrom(realCursorId, msg.data.move.stone));

								const wasStarted = clockStarted;
								const isStartingNow = !wasStarted && prevMoveCount === 0;
								if (isStartingNow && clockSettings.enabled) clockStarted = true;

								const nextTurn = playerFromIndex(prevMoveCount + 1);
								if (!isStartingNow)
									applyClockTurnTransition(
										prevTurn,
										nextTurn,
										msg.data.move.atMs,
									);
								else clockLastAtMs = msg.data.move.atMs;
							}
							break;
						case "set size":
							size = msg.data;
							resetHistory();
							sharedOverlay = emptyOverlayState();
							sharedOverlayVersion += 1;
							sharedPreviewHoldersById = {};
							break;
						case "set colors":
							hasReceivedServerColors = true;
							player1Color = msg.data.p1;
							player2Color = msg.data.p2;
							isColorInitialized = true;
							break;
						case "full":
							break;
						case "assign id":
							id = msg.data;
							if (connected && !hasSentInitialSize) {
								send(ws, {
									type: "set size",
									data: size,
								});
								hasSentInitialSize = true;
							}
							if (
								connected &&
								!hasSentInitialColors &&
								!hasReceivedServerColors
							) {
								send(ws, {
									type: "set colors",
									data: { p1: player1Color, p2: player2Color },
								});
								hasSentInitialColors = true;
							}
							break;
						case "assign player":
							assignedPlayer = msg.data;
							break;
						case "undo":
							{
								const prevMoveCount =
									id === msg.data.senderId ? realMoveCount + 1 : realMoveCount;
								const prevTurn = playerFromIndex(prevMoveCount);
								settleClockTo(prevTurn, msg.data.atMs);
								if (id !== msg.data.senderId) {
									const parent = nodeAt(realCursorId).parent;
									if (parent !== null) setRealCursor(parent);
								}
								applyClockTurnTransition(
									prevTurn,
									playerFromIndex(Math.max(0, prevMoveCount - 1)),
									msg.data.atMs,
								);
							}
							break;
						case "swap":
							{
								const prevMoveCount = realMoveCount;
								const prevTurn = playerFromIndex(prevMoveCount);
								settleClockTo(prevTurn, msg.data.atMs);
								if (id !== msg.data.senderId) {
									const cur = nodeAt(realCursorId);
									if (cur.stonePly === 1 && !cur.playersSwapped)
										setRealCursor(advanceSwapFrom(realCursorId));
								}
								applyClockTurnTransition(prevTurn, prevTurn, msg.data.atMs);
							}
							break;
						case "clock":
							{
								const prevTurn = turnPlayer;
								settleClockTo(prevTurn, msg.data.atMs);
								switch (msg.data.op.kind) {
									case "pause":
										clockPaused = msg.data.op.paused;
										clockLastAtMs = msg.data.atMs;
										break;
									case "settings":
										resetClock(msg.data.op.settings);
										clockLastAtMs = msg.data.atMs;
										break;
									default:
										ensureCoverage(msg.data.op);
								}
							}
							break;
						case "shared preview":
							{
								const { senderId, op } = msg.data;
								switch (op.kind) {
									case "presence":
										{
											const next = { ...sharedPreviewHoldersById };
											if (op.active) next[senderId] = true;
											else delete next[senderId];
											sharedPreviewHoldersById = next;
										}
										break;
									case "add":
										{
											const { changed } = overlayUpsertAdd(
												sharedOverlay,
												op.parentKey,
												op.move,
											);
											if (changed) sharedOverlayVersion += 1;
										}
										break;
									case "delete":
										{
											const subtree = overlaySubtreeKeys(
												sharedOverlay,
												op.rootKey,
											);
											const deletedSet = new Set(subtree);
											const changed = overlayDeleteSubtree(
												sharedOverlay,
												op.rootKey,
											);
											if (!changed) break;

											sharedOverlayVersion += 1;
											if (hoverKey && deletedSet.has(hoverKey)) hoverKey = null;
											if (deletedSet.has(activeKey)) {
												const parent = parentKeyOf(op.rootKey) ?? rootKey;
												setActiveKey(parent);
											}
										}
										break;
									default:
										ensureCoverage(op);
								}
							}
							break;
						default:
							ensureCoverage(msg);
					}
				},
				console.warn,
			);
		};

		const onClose = () => {
			connected = false;
			id = null;
			assignedPlayer = null;
			hasSentInitialSize = false;
			hasSentInitialColors = false;
			sharedOverlay = emptyOverlayState();
			sharedOverlayVersion += 1;
			sharedPreviewHoldersById = {};
		};

		ws.addEventListener("open", onOpen);
		ws.addEventListener("message", onMessage);
		ws.addEventListener("close", onClose);

		return () => {
			ws.removeEventListener("open", onOpen);
			ws.removeEventListener("message", onMessage);
			ws.removeEventListener("close", onClose);
		};
	});

	const undoReal = (): void => {
		const cur = nodeAt(realCursorId);
		if (cur.parent === null) return;
		if (playerMode === 1) {
			const atMs = Date.now();
			const prevMoveCount = realMoveCount;
			const prevTurn = playerFromIndex(prevMoveCount);
			settleClockTo(prevTurn, atMs);
			setRealCursor(cur.parent);
			applyClockTurnTransition(
				prevTurn,
				playerFromIndex(Math.max(0, prevMoveCount - 1)),
				atMs,
			);
			return;
		}
		setRealCursor(cur.parent);
	};

	const undoActive = (): void => {
		const parent = parentKeyOf(activeKey);
		if (!parent) return;
		setActiveKey(parent);
	};

	const swapReal = (): void => {
		const cur = nodeAt(realCursorId);
		if (cur.stonePly !== 1) return;
		if (cur.playersSwapped) return;
		if (playerMode === 1) {
			const atMs = Date.now();
			const prevMoveCount = realMoveCount;
			const prevTurn = playerFromIndex(prevMoveCount);
			settleClockTo(prevTurn, atMs);
			setRealCursor(advanceSwapFrom(realCursorId));
			applyClockTurnTransition(prevTurn, prevTurn, atMs);
			return;
		}
		setRealCursor(advanceSwapFrom(realCursorId));
	};

	const epsilon = 1e-3;
	let isZoomedIn = $derived(
		viewBox.w < size - epsilon || viewBox.h < size - epsilon,
	);
	let isButtingLeft = $derived(viewBox.x <= epsilon);
	let isButtingTop = $derived(viewBox.y <= epsilon);
	let isButtingRight = $derived(viewBox.x + viewBox.w >= size - epsilon);
	let isButtingBottom = $derived(viewBox.y + viewBox.h >= size - epsilon);

	let borderLeftColor = $derived(
		!isZoomedIn || isButtingLeft ? player2Color : "black",
	);
	let borderTopColor = $derived(
		!isZoomedIn || isButtingTop ? player1Color : "black",
	);
	let borderRightColor = $derived(
		!isZoomedIn || isButtingRight ? player2Color : "black",
	);
	let borderBottomColor = $derived(
		!isZoomedIn || isButtingBottom ? player1Color : "black",
	);

	let isZoomAtOneX = $derived(
		Math.abs(viewBox.w - size) < 1e-6 && Math.abs(viewBox.h - size) < 1e-6,
	);

	const stoneFillAtIndex = (moveIndex: number): string => {
		return playerColor(playerFromIndex(moveIndex));
	};

	const stoneIndexTextStyle = (
		moveIndex: number,
	): { fill: "black" | "white"; stroke: "black" | "white" } => {
		return readableTextColorOn(stoneFillAtIndex(moveIndex));
	};

	let gridLines = $derived(Array.from({ length: size + 1 }, (_, i) => i));
	let gridOpacity = $state(0);
	let gridFlashToken = $state(0);
	let lastGridFlashSize = $state<number | null>(null);
	let gridTransition = $state("none");

	$effect(() => {
		if (typeof window === "undefined") return;

		if (lastGridFlashSize === null) {
			lastGridFlashSize = size;
			return;
		}

		if (size === lastGridFlashSize) return;
		lastGridFlashSize = size;

		gridFlashToken += 1;
		const token = gridFlashToken;
		gridTransition = "none";
		gridOpacity = 1;

		window.setTimeout(() => {
			if (gridFlashToken !== token) return;
			gridTransition = "opacity 700ms ease";
			queueMicrotask(() => {
				if (gridFlashToken !== token) return;
				gridOpacity = 0;
			});
		}, 2200);
	});
	let movesForRender = $derived(displayMoves.map((stone, i) => ({ stone, i })));
	let movesForStones = $derived(movesForRender.toReversed());
	let componentOutlineHalfWidth = $derived(
		svgPixels && svgPixels.w > 0
			? viewBox.w / svgPixels.w / 2
			: viewBox.w / 800,
	);
	let componentOutlineFilterMargin = $derived(
		Math.max(componentOutlineHalfWidth * 8, viewBox.w / 200),
	);

	const multiPolygonToPath = (mp: MultiPolygon): string => {
		let d = "";
		for (const poly of mp) {
			for (const ring of poly) {
				if (ring.length === 0) continue;
				d += `M ${ring[0]![0]} ${ring[0]![1]}`;
				for (let i = 1; i < ring.length; i++)
					d += ` L ${ring[i]![0]} ${ring[i]![1]}`;
				d += " Z ";
			}
		}
		return d.trim();
	};

	const computeCutoutPathsForSeq = (
		seq: StoneData[],
	): { p1: string[]; p2: string[] } => {
		const occludersP1: StoneData[] = [];
		const occludersP2: StoneData[] = [];
		const outP1: string[] = [];
		const outP2: string[] = [];

		for (let i = 0; i < seq.length; i++) {
			const stone = seq[i];
			if (!stone) continue;
			const player = playerFromIndex(i);
			const cuts = player === 1 ? occludersP2 : occludersP1;

			const subjectAabb = stoneAabb(stone);
			const cutPolys: MultiPolygon[] = [];
			for (const c of cuts)
				if (aabbIntersects(subjectAabb, stoneAabb(c)))
					cutPolys.push(stonePolyAt(c));

			let mp: MultiPolygon;
			if (cutPolys.length === 0) mp = stonePolyAt(stone);
			else
				mp = (
					polygonClipping as unknown as {
						difference: (a: MultiPolygon, ...b: MultiPolygon[]) => MultiPolygon;
					}
				).difference(stonePolyAt(stone), ...cutPolys);

			if (mp.length > 0) {
				const path = multiPolygonToPath(mp);
				if (path) {
					if (player === 1) outP1.push(path);
					else outP2.push(path);
				}
			}

			if (player === 1) occludersP1.push(stone);
			else occludersP2.push(stone);
		}

		return { p1: outP1, p2: outP2 };
	};

	let componentCutoutPaths = $derived(
		(() => {
			if (isPreviewEnabled) return computeCutoutPathsForSeq(displayMoves);

			const p1: string[] = [];
			const p2: string[] = [];
			for (const id of realStoneIds) {
				const n = nodeAt(id);
				if (n.move?.kind !== "stone") continue;
				const cut = n.cutoutPolys;
				if (!cut || cut.length === 0) continue;
				const idx = n.stonePly - 1;
				if (idx < 0) continue;
				const path = multiPolygonToPath(cut);
				if (!path) continue;
				if (playerFromIndex(idx) === 1) p1.push(path);
				else p2.push(path);
			}
			return { p1, p2 };
		})(),
	);

	const handleWheel = (e: WheelEvent): void => {
		updateMouseLocImmediately(e);

		if (e.altKey && svgPixels && svgPixels.w > 0 && viewBox.w > 0) {
			e.preventDefault();
			const step = Math.sign(e.deltaY);
			if (step === 0) return;

			const arcPx = e.shiftKey ? 4 : 14;
			const pxPerUnit = svgPixels.w / viewBox.w;
			const cornerRadiusPx = (Math.SQRT2 / 2) * pxPerUnit;
			if (cornerRadiusPx <= 0) return;
			const dTheta = arcPx / cornerRadiusPx;
			placementTheta += step * dTheta;
			return;
		}

		const scale = Math.pow(1.0015, e.deltaY);
		const nextW = viewBox.w * scale;
		const nextH = viewBox.h * scale;

		const ratioW = nextW / viewBox.w;
		const ratioH = nextH / viewBox.h;
		const anchorX = mouseLoc[0];
		const anchorY = mouseLoc[1];

		viewBox = clampViewBox({
			x: anchorX - (anchorX - viewBox.x) * ratioW,
			y: anchorY - (anchorY - viewBox.y) * ratioH,
			w: nextW,
			h: nextH,
		});
	};

	const handlePointerDown = (e: PointerEvent): void => {
		if (!svg) return;

		updateMouseLocImmediately(e);
		if (!isFiniteNumber(mouseLoc[0]) || !isFiniteNumber(mouseLoc[1])) return;

		if (e.button === 2) {
			const rect = svg.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) return;

			e.preventDefault();
			e.stopPropagation();
			panSession = {
				startClient: [e.clientX, e.clientY],
				startViewBox: { ...viewBox },
				unitsPerPixelX: viewBox.w / rect.width,
				unitsPerPixelY: viewBox.h / rect.height,
			};
			svg.setPointerCapture(e.pointerId);
			return;
		}

		if (e.button === 0) {
			if (mouseOverHistory) return;

			if (playerMode === 1) {
				const atMs = Date.now();
				const prevMoveCount = realMoveCount;
				const prevTurn = playerFromIndex(prevMoveCount);
				settleClockTo(prevTurn, atMs);

				setRealCursor(
					advanceFrom(realCursorId, {
						coords: mouseLoc,
						theta: placementTheta,
					}),
				);

				const wasStarted = clockStarted;
				const isStartingNow = !wasStarted && prevMoveCount === 0;
				if (isStartingNow) {
					if (clockSettings.enabled) {
						clockStarted = true;
						clockLastAtMs = atMs;
					}
				} else {
					const nextTurn = playerFromIndex(prevMoveCount + 1);
					applyClockTurnTransition(prevTurn, nextTurn, atMs);
				}
				return;
			}

			if (isPreviewEnabled) {
				if (isSharedPreviewEditEnabled && connected) {
					const op: SharedPreviewOp = {
						kind: "add",
						parentKey: activeKey,
						move: {
							kind: "stone",
							stone: { coords: mouseLoc, theta: placementTheta },
						},
					};
					const { key: nextKey, changed } = overlayUpsertAdd(
						sharedOverlay,
						op.parentKey,
						op.move,
					);
					if (changed) {
						sharedOverlayVersion += 1;
						setActiveKey(nextKey);
						send(playerMode.socket, { type: "shared preview", data: op });
					}
				} else {
					const fromId = baselineIdByKey[activeKey] ?? realCursorId;
					const nextId = advanceFrom(fromId, {
						coords: mouseLoc,
						theta: placementTheta,
					});
					hasStagedBaselineChanges = true;
					setActiveKey(baselineKeyById[nextId] ?? activeKey);
				}
				return;
			}

			if (myTurn && connected) {
				setRealCursor(
					advanceFrom(realCursorId, {
						coords: mouseLoc,
						theta: placementTheta,
					}),
				);
				send(playerMode.socket, {
					type: "move",
					data: { coords: mouseLoc, theta: placementTheta },
				});
			}
		}
	};

	const handlePointerMove = (e: PointerEvent): void => {
		if (!svg || !panSession) {
			updateMouseLoc(e);
			return;
		}

		schedulePanUpdate(e.clientX, e.clientY);
		updateMouseLoc(e);
	};

	const handlePointerUpOrCancel = (): void => {
		panSession = null;
		pendingPanClient = null;
	};

	const resetView = (): void => {
		viewBox = { x: 0, y: 0, w: size, h: size };
	};

	const setHoverCursor = (next: StableKey | null): void => {
		hoverKey = next;
	};

	const selectHistoryNode = (next: StableKey): void => {
		if (!isHistoryClickEnabled) return;

		if (playerMode === 1) {
			const id = baselineIdByKey[next];
			if (id === undefined) return;
			setRealCursor(id);
			activeKey = next;
			return;
		}

		if (isPreviewEnabled) setActiveKey(next);
	};

	const subtreeIdsAt = (rootId: NodeId): NodeId[] => {
		const out: NodeId[] = [];
		const stack: NodeId[] = [rootId];
		while (stack.length > 0) {
			const id = stack.pop();
			if (id === undefined) break;
			const n = historyNodes[id];
			if (!n) continue;
			out.push(id);
			for (const child of n.children) stack.push(child);
		}
		return out;
	};

	const subtreeHasReal = (rootId: NodeId): boolean => {
		for (const id of subtreeIdsAt(rootId)) {
			if (realPathById[id]) return true;
		}
		return false;
	};

	const canDeleteHistoryNode = (id: NodeId): boolean => {
		if (id === historyRootId) return false;
		if (subtreeHasReal(id)) return false;
		return !!historyNodes[id];
	};

	const canDeleteHistoryKey = (key: StableKey): boolean => {
		if (key === rootKey) return false;
		if (isSharedPreviewEditEnabled && overlayGet(sharedOverlay, key))
			return true;

		const id = baselineIdByKey[key];
		if (id === undefined) return false;
		return canDeleteHistoryNode(id);
	};

	const deleteHistoryKey = (key: StableKey): void => {
		if (key === rootKey) return;

		if (isSharedPreviewEditEnabled && overlayGet(sharedOverlay, key)) {
			const subtree = overlaySubtreeKeys(sharedOverlay, key);
			const deletedSet = new Set(subtree);
			const changed = overlayDeleteSubtree(sharedOverlay, key);
			if (!changed) return;

			sharedOverlayVersion += 1;
			if (connected && playerMode !== 1) {
				const op: SharedPreviewOp = { kind: "delete", rootKey: key };
				send(playerMode.socket, { type: "shared preview", data: op });
			}

			if (hoverKey && deletedSet.has(hoverKey)) hoverKey = null;
			if (deletedSet.has(activeKey)) {
				const parent = parentKeyOf(key) ?? rootKey;
				setActiveKey(parent);
			}
			return;
		}

		const id = baselineIdByKey[key];
		if (id === undefined) return;
		deleteHistoryNode(id);
	};

	const deleteHistoryNode = (id: NodeId): void => {
		if (!canDeleteHistoryNode(id)) return;

		if (isPreviewEnabled && !isSharedPreviewEditEnabled)
			hasStagedBaselineChanges = true;

		const n = nodeAt(id);
		if (n.parent === null) return;
		const parentId = n.parent;
		const parent = nodeAt(parentId);
		const updatedParent: HistoryNode = {
			...parent,
			children: parent.children.filter((childId) => childId !== id),
		};

		const subtreeIds = subtreeIdsAt(id);
		const nextNodes = historyNodes.slice();
		nextNodes[parentId] = updatedParent;
		for (const nodeId of subtreeIds) nextNodes[nodeId] = null;
		historyNodes = nextNodes;

		const deleted = new Set(subtreeIds);
		const hoverId = hoverKey ? baselineIdByKey[hoverKey] : undefined;
		if (hoverId !== undefined && deleted.has(hoverId)) hoverKey = null;

		const activeId = baselineIdByKey[activeKey];
		if (activeId !== undefined && deleted.has(activeId))
			activeKey = baselineKeyById[parentId] ?? rootKey;
	};

	type RenderNode = {
		key: StableKey;
		parentKey: StableKey | null;
		ply: number;
		kind: "root" | "stone" | "swap";
		layer: "baseline" | "shared";
	};

	const renderTreeNodes = $derived(
		((): RenderNode[] => {
			void sharedOverlayVersion;
			const out: RenderNode[] = [];

			for (let id = 0; id < historyNodes.length; id += 1) {
				const n = historyNodes[id];
				if (!n) continue;
				const key = baselineKeyById[id];
				if (!key) continue;

				const parentKey =
					n.parent === null ? null : (baselineKeyById[n.parent] ?? rootKey);

				out.push({
					key,
					parentKey,
					ply: n.ply,
					kind: n.kind,
					layer: "baseline",
				});
			}

			if (isSharedOverlayVisible) {
				for (const n of sharedOverlay.nodesByKey.values()) {
					out.push({
						key: n.key,
						parentKey: n.parentKey,
						ply: keyDepth(n.key),
						kind: n.kind,
						layer: "shared",
					});
				}
			}

			return out;
		})(),
	);

	const sharedPreviewHolderCount = $derived(
		Object.keys(sharedPreviewHoldersById).length,
	);

	const isSharedPreviewLive = $derived(
		sharedPreviewHolderCount > 0 || isSharedPreviewEditEnabled,
	);

	const saveKey = $derived(
		(() => {
			if (isPreviewEnabled && hasStagedBaselineChanges) return activeKey;
			if (!isSharedOverlayVisible) return activeKey;
			return hoverKey ?? activeKey;
		})(),
	);

	const isSaveShown = $derived(
		(() => {
			void sharedOverlayVersion;
			if (isPreviewEnabled && hasStagedBaselineChanges) return true;
			if (!isSharedOverlayVisible) return false;
			return overlaySubtreeRootedAt(saveKey).length > 0;
		})(),
	);

	const saveTitle = $derived(
		isPreviewEnabled && hasStagedBaselineChanges
			? "Save preview changes"
			: "Save shared preview subtree",
	);

	const save = (): void => {
		if (isPreviewEnabled && hasStagedBaselineChanges) saveLocalStagedPreview();
		else importSharedOverlaySubtree(saveKey);
	};
</script>

<div class="layout">
	<div class="stage">
		<div class="boardCell">
			<svg
				bind:this={svg}
				viewBox={viewBoxStr}
				oncontextmenu={(e) => e.preventDefault()}
				onpointerenter={(e) => {
					updateMouseLocImmediately(e);
					mouseOver = true;
				}}
				onpointerleave={() => (mouseOver = false)}
				onpointermove={handlePointerMove}
				onpointerdown={handlePointerDown}
				onpointerup={handlePointerUpOrCancel}
				onpointercancel={handlePointerUpOrCancel}
				onwheel={(e) => {
					e.preventDefault();
					handleWheel(e);
				}}
				class="board"
				style:border-left-color={borderLeftColor}
				style:border-top-color={borderTopColor}
				style:border-right-color={borderRightColor}
				style:border-bottom-color={borderBottomColor}
			>
				<g
					class="grid"
					aria-hidden="true"
					style:opacity={gridOpacity}
					style:transition={gridTransition}
				>
					{#each gridLines as i (i)}
						<line
							x1={i}
							y1="0"
							x2={i}
							y2={size}
							stroke="black"
							stroke-opacity="0.22"
							stroke-width="0.03"
						></line>
						<line
							x1="0"
							y1={i}
							x2={size}
							y2={i}
							stroke="black"
							stroke-opacity="0.22"
							stroke-width="0.03"
						></line>
					{/each}
				</g>

				{#if isShiftHeld}
					{#each movesForRender as move (move.i)}
						{@const d = pathFromHull(
							shadowHullForStone(move.stone, placementTheta),
						)}
						{#if d}
							<path
								{d}
								fill={playerColor(playerFromIndex(move.i))}
								fill-opacity="0.16"
							></path>
						{/if}
					{/each}
				{/if}

				{#snippet shape(
					stone: StoneData,
					index: number,
					isHighlighted: boolean,
					opacity: number,
				)}
					{@const cx = stone.coords[0]}
					{@const cy = stone.coords[1]}
					<rect
						x={cx - 1 / 2}
						y={cy - 1 / 2}
						width="1"
						height="1"
						fill={playerColor(playerFromIndex(index))}
						fill-opacity={opacity}
						stroke={isHighlighted ? "black" : "none"}
						stroke-width={isHighlighted ? 2 : 0}
						vector-effect="non-scaling-stroke"
						transform={`rotate(${(stone.theta * 180) / Math.PI} ${cx} ${cy})`}
					></rect>
				{/snippet}

				{#if isPreviewStoneShown}
					{@render shape(
						{ coords: mouseLoc, theta: placementTheta },
						displayMoveCount,
						false,
						0.75,
					)}
				{/if}

				{#each movesForStones as move (move.i)}
					{@render shape(move.stone, move.i, false, 1)}
				{/each}

				{#if isShiftHeld && displayMoveCount > 0 && svgPixels && svgPixels.w > 0}
					{@const latestStone = displayMoves[displayMoveCount - 1]}
					{@const unitsPerPx = viewBox.w / svgPixels.w}
					{@const t = unitsPerPx * 2}
					{#if latestStone}
						{@const cx = latestStone.coords[0]}
						{@const cy = latestStone.coords[1]}
						{@const thetaDeg = (latestStone.theta * 180) / Math.PI}
						<path
							d={`M ${cx - 1 / 2 - t} ${cy - 1 / 2 - t} h ${1 + 2 * t} v ${1 + 2 * t} h ${-(1 + 2 * t)} Z M ${cx - 1 / 2} ${cy - 1 / 2} h 1 v 1 h -1 Z`}
							fill="rgba(0,0,0,0.95)"
							fill-rule="evenodd"
							style:pointer-events="none"
							transform={`rotate(${thetaDeg} ${cx} ${cy})`}
						></path>
					{/if}
				{/if}

				{#if isComponentOutlinesEnabled}
					<defs>
						<filter
							id="componentOutlineFilter"
							filterUnits="userSpaceOnUse"
							x={-componentOutlineFilterMargin}
							y={-componentOutlineFilterMargin}
							width={size + componentOutlineFilterMargin * 2}
							height={size + componentOutlineFilterMargin * 2}
						>
							<feMorphology
								in="SourceAlpha"
								operator="dilate"
								radius={componentOutlineHalfWidth}
								result="d"
							/>
							<feMorphology
								in="SourceAlpha"
								operator="erode"
								radius={componentOutlineHalfWidth}
								result="e"
							/>
							<feComposite in="d" in2="e" operator="out" result="ring" />
							<feFlood flood-color="black" result="black" />
							<feComposite in="black" in2="ring" operator="in" result="o" />
							<feMerge>
								<feMergeNode in="o" />
							</feMerge>
						</filter>
					</defs>

					<g pointer-events="none">
						<g filter="url(#componentOutlineFilter)">
							{#each componentCutoutPaths.p1 as d (d)}
								<path {d} fill="black" fill-rule="evenodd"></path>
							{/each}
						</g>
						<g filter="url(#componentOutlineFilter)">
							{#each componentCutoutPaths.p2 as d (d)}
								<path {d} fill="black" fill-rule="evenodd"></path>
							{/each}
						</g>
					</g>
				{/if}

				{#if isShiftHeld}
					{#each movesForRender as move (move.i)}
						{@const indexTextStyle = stoneIndexTextStyle(move.i)}
						<text
							x={move.stone.coords[0]}
							y={move.stone.coords[1]}
							text-anchor="middle"
							dominant-baseline="central"
							font-size="0.3"
							fill={indexTextStyle.fill}
							stroke={indexTextStyle.stroke}
							stroke-width="0.06"
							paint-order="stroke"
							vector-effect="non-scaling-stroke"
							style:pointer-events="none"
						>
							{move.i + 1}
						</text>
					{/each}
				{/if}
			</svg>
		</div>
		<div class="sidebarCell">
			<Toolbar
				{playerMode}
				{connected}
				{isMultiplayerEnabled}
				setMultiplayerEnabled={(next) => setMultiplayerEnabled?.(next)}
				{copyBoardShot}
				{boardShotCopyState}
				{turnText}
				{turnColor}
				{clockStarted}
				{clockPaused}
				clockEnabled={clockSettings.enabled}
				clockTotalMs={clockSettings.totalMs}
				clockGainMs={clockSettings.gainMs}
				clockRemainingMsP1={clockDisplayRemainingMsP1}
				clockRemainingMsP2={clockDisplayRemainingMsP2}
				clockActivePlayer={turnPlayer}
				toggleClockEnabled={() => {
					const nextSettings: ClockSettings = {
						...clockSettings,
						enabled: !clockSettings.enabled,
					};
					if (playerMode === 1 || !connected) resetClock(nextSettings);
					else
						send(playerMode.socket, {
							type: "clock",
							data: { kind: "settings", settings: nextSettings },
						});
				}}
				setClockTotalMs={(next) => {
					const nextSettings: ClockSettings = {
						...clockSettings,
						totalMs: next,
					};
					if (playerMode === 1 || !connected) resetClock(nextSettings);
					else
						send(playerMode.socket, {
							type: "clock",
							data: { kind: "settings", settings: nextSettings },
						});
				}}
				setClockGainMs={(next) => {
					const nextSettings: ClockSettings = {
						...clockSettings,
						gainMs: next,
					};
					if (playerMode === 1 || !connected) resetClock(nextSettings);
					else
						send(playerMode.socket, {
							type: "clock",
							data: { kind: "settings", settings: nextSettings },
						});
				}}
				toggleClockPaused={() => {
					if (playerMode === 1 || !connected) {
						const atMs = Date.now();
						settleClockTo(turnPlayer, atMs);
						clockPaused = !clockPaused;
						clockLastAtMs = atMs;
						return;
					}
					send(playerMode.socket, {
						type: "clock",
						data: { kind: "pause", paused: !clockPaused },
					});
				}}
				{size}
				movesPlayed={realMoveCount}
				{minBoardSize}
				{maxBoardSize}
				{applyBoardSize}
				bind:isComponentOutlinesEnabled
				{wsUrl}
				bind:wsUrlDraft
				{wsUrlError}
				{saveWsUrl}
				bind:player1Color
				bind:player2Color
				{commitColors}
				{resetColors}
				isResetColorsDisabled={isUsingDefaultColors}
				resetColorsTitle={isUsingDefaultColors
					? "Already using default colors"
					: "Reset colors"}
				zoomX={size / viewBox.w}
				{isZoomAtOneX}
				{resetView}
				isUndoDisabled={(isPreviewEnabled
					? activeMoveCount === 0
					: realMoveCount === 0) ||
					(playerMode !== 1 && !isPreviewEnabled && !connected)}
				undo={() => {
					if (playerMode === 1) {
						undoReal();
						return;
					}

					if (isPreviewEnabled) {
						undoActive();
						return;
					}

					if (connected) {
						undoReal();
						send(playerMode.socket, { type: "undo" });
					}
				}}
				{newGame}
				isSwapShown={true}
				isSwapDisabled={playerMode === 1
					? realMoveCount !== 1 || nodeAt(realCursorId).playersSwapped
					: !connected ||
						realMoveCount !== 1 ||
						!myTurn ||
						nodeAt(realCursorId).playersSwapped ||
						isPreviewEnabled}
				swap={() => {
					swapReal();
					if (playerMode !== 1 && connected && !isPreviewEnabled)
						send(playerMode.socket, { type: "swap" });
				}}
			/>
		</div>
		<div
			class="historyPanel"
			class:preview={isPreviewEnabled}
			onpointerenter={() => (mouseOverHistory = true)}
			onpointerleave={() => {
				mouseOverHistory = false;
				setHoverCursor(null);
			}}
		>
			<div class="historyHeader">
				<div>game tree</div>
				<div class="historyHeaderRight">
					{#if playerMode !== 1 && isSharedPreviewEditEnabled}
						<div
							class="ctrlAltHeld"
							title="Shared preview (holding ctrl+alt) • your preview edits are sent"
						>
							CTRL+ALT
						</div>
					{:else if playerMode !== 1 && isSharedOverlayVisible && isSharedPreviewLive}
						<div
							class="sharedLive"
							title="Shared preview overlay (live) • hold ctrl to hide"
						>
							SHARED{sharedPreviewHolderCount > 0
								? ` (${sharedPreviewHolderCount})`
								: ""}
						</div>
					{:else if playerMode !== 1 && isPreviewEnabled}
						<div class="ctrlHeld" title="Preview mode (holding ctrl)">
							CTRL HELD
						</div>
					{/if}
				</div>
			</div>
			<HistoryTree
				nodes={renderTreeNodes}
				{rootKey}
				{realKey}
				{realPathByKey}
				{activeKey}
				{hoverKey}
				isHoverEnabled={true}
				isClickEnabled={isHistoryClickEnabled}
				{isSaveShown}
				{saveKey}
				{saveTitle}
				{save}
				setHover={setHoverCursor}
				select={selectHistoryNode}
				canDelete={canDeleteHistoryKey}
				del={deleteHistoryKey}
			/>
			<div class="historyNote">
				hover: preview • click: jump • right click: delete branch
			</div>
			{#if playerMode !== 1}
				<div class="historyNote">
					preview mode: {isPreviewEnabled ? "on" : "off"} (hold ctrl). preview mode
					lets you explore game branches without affecting the real multiplayer game
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.layout {
		display: flex;
		justify-content: center;
		align-items: flex-start;
		height: 100vh;
		padding: 12px;
		box-sizing: border-box;
		overflow: hidden;
	}

	.stage {
		display: grid;
		--pad: 12px;
		--gap: 12px;
		--sidebar-w: 320px;
		--history-min: 180px;
		--board-size: clamp(
			320px,
			min(
				72vmin,
				calc(100vh - 2 * var(--pad) - var(--history-min) - var(--gap))
			),
			900px
		);

		grid-template-columns: var(--board-size) var(--sidebar-w);
		grid-template-rows: var(--board-size) minmax(var(--history-min), 1fr);
		gap: var(--gap);
		align-items: start;
		height: 100%;
		min-height: 0;
	}

	@media (max-width: 980px) {
		.stage {
			--sidebar-w: min(320px, 100%);
			--history-min: 200px;
			--board-size: clamp(
				280px,
				min(
					92vmin,
					calc(100vh - 2 * var(--pad) - var(--history-min) - var(--gap))
				),
				900px
			);

			grid-template-columns: 1fr;
			grid-template-rows: var(--board-size) auto minmax(var(--history-min), 1fr);
		}
	}

	.boardCell {
		width: var(--board-size);
		height: var(--board-size);
		min-width: 0;
		min-height: 0;
		box-sizing: border-box;
	}

	.grid {
		pointer-events: none;
	}

	.sidebarCell {
		width: var(--sidebar-w);
		height: var(--board-size);
		min-width: 0;
		min-height: 0;
		box-sizing: border-box;
		overflow: auto;
		align-self: start;
		justify-self: start;
	}

	@media (max-width: 980px) {
		.sidebarCell {
			width: 100%;
			height: auto;
			max-height: 38vh;
		}
	}

	.historyPanel {
		grid-column: 1 / -1;
		border-radius: 12px;
		padding: 10px;
		border: 1px solid rgba(0, 0, 0, 0.08);
		background: rgba(255, 255, 255, 0.72);
		backdrop-filter: blur(10px);
		box-shadow: 0 14px 36px rgba(0, 0, 0, 0.12);
		color: rgba(0, 0, 0, 0.84);
		overflow: auto;
		min-height: 0;
		box-sizing: border-box;
	}

	.historyPanel.preview {
		border-color: rgba(30, 58, 138, 0.35);
		box-shadow:
			0 14px 36px rgba(0, 0, 0, 0.12),
			0 0 0 4px rgba(30, 58, 138, 0.14);
	}

	.historyHeader {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 6px;
	}

	.historyHeaderRight {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.ctrlHeld {
		padding: 3px 8px;
		border-radius: 999px;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.4px;
		background: rgba(30, 58, 138, 0.94);
		color: white;
		box-shadow:
			0 10px 24px rgba(0, 0, 0, 0.2),
			0 0 0 2px rgba(255, 255, 255, 0.7) inset;
		animation: ctrlHeldPulse 1.15s ease-in-out infinite;
	}

	@keyframes ctrlHeldPulse {
		0%,
		100% {
			transform: translateY(0);
			filter: saturate(1);
		}
		50% {
			transform: translateY(-1px);
			filter: saturate(1.25);
		}
	}

	.ctrlAltHeld {
		padding: 3px 10px;
		border-radius: 999px;
		font-size: 12px;
		font-weight: 800;
		letter-spacing: 0.4px;
		background: rgba(190, 24, 93, 0.94);
		color: white;
		box-shadow:
			0 10px 24px rgba(0, 0, 0, 0.2),
			0 0 0 2px rgba(255, 255, 255, 0.7) inset;
		animation: ctrlHeldPulse 1.05s ease-in-out infinite;
	}

	.sharedLive {
		padding: 3px 10px;
		border-radius: 999px;
		font-size: 12px;
		font-weight: 750;
		letter-spacing: 0.3px;
		background: rgba(15, 118, 110, 0.92);
		color: white;
		box-shadow:
			0 10px 24px rgba(0, 0, 0, 0.18),
			0 0 0 2px rgba(255, 255, 255, 0.65) inset;
	}

	.historyNote {
		margin-top: 4px;
		opacity: 0.75;
		font-size: 12px;
		line-height: 1.2;
	}

	.board {
		width: 100%;
		height: 100%;
		border: 10px solid;
		background:
			radial-gradient(
				900px 700px at 20% 18%,
				rgba(255, 255, 255, 0.75),
				rgba(255, 255, 255, 0) 60%
			),
			linear-gradient(180deg, var(--board-bg, #f3efe6), #e8e1d5);
		box-shadow:
			0 14px 40px rgba(0, 0, 0, 0.18),
			0 2px 0 rgba(0, 0, 0, 0.12);
		border-radius: 12px;
		box-sizing: border-box;
	}
</style>
