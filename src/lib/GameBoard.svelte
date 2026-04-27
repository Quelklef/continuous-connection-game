<script lang="ts">
	import { Bad, ensureCoverage } from "../../shared/lib.ts";
	import type {
		ServerMessage,
		InnerClientMessage,
		MoveData,
		Player,
	} from "../../shared/types.ts";
	import {
		isBoardColors,
		isFiniteNumber,
		isMoveData,
		isValidBoardSize,
		isValidHexColor,
		MAX_BOARD_SIZE,
		MIN_BOARD_SIZE,
	} from "../../shared/validate.ts";
	import HistoryTree from "$lib/HistoryTree.svelte";
	import Toolbar from "$lib/Toolbar.svelte";
	type Props = {
		size: number;
		moves: MoveData[];
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

	const playerFromIndex = (index: number): Player => {
		return index % 2 === 0 ? 1 : 2;
	};

	type NodeId = number;
	type HistoryMove = { kind: "stone"; coords: MoveData } | { kind: "swap" };
	type HistoryNode = {
		id: NodeId;
		parent: NodeId | null;
		move: HistoryMove | null;
		kind: "root" | "stone" | "swap";
		ply: number;
		stonePly: number;
		playersSwapped: boolean;
		children: NodeId[];
	};

	let historyNodes = $state<(HistoryNode | null)[]>([]);
	let historyRootId = $state<NodeId>(0);
	let historyNextId = $state<NodeId>(1);
	let realCursorId = $state<NodeId>(0);
	let activeCursorId = $state<NodeId>(0);
	let hoverCursorId = $state<NodeId | null>(null);
	let lastPreviewCursorId = $state<NodeId>(0);

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
		};
		historyNodes = [];
		historyNodes[0] = root;
		historyRootId = 0;
		historyNextId = 1;
		realCursorId = 0;
		activeCursorId = 0;
		hoverCursorId = null;
	};

	resetHistory();

	const moveMatchEpsilon = 1e-4;
	const isSameMove = (a: MoveData, b: MoveData): boolean => {
		return (
			Math.abs(a[0] - b[0]) <= moveMatchEpsilon &&
			Math.abs(a[1] - b[1]) <= moveMatchEpsilon
		);
	};

	const advanceFrom = (fromId: NodeId, move: MoveData): NodeId => {
		const from = nodeAt(fromId);
		const existing = from.children.find((childId) => {
			const child = nodeAt(childId);
			if (child.move?.kind !== "stone") return false;
			return isSameMove(child.move.coords, move);
		});
		if (existing !== undefined) return existing;

		const nextId = historyNextId;
		historyNextId += 1;
		const next: HistoryNode = {
			id: nextId,
			parent: fromId,
			move: { kind: "stone", coords: move },
			kind: "stone",
			ply: from.ply + 1,
			stonePly: from.stonePly + 1,
			playersSwapped: from.playersSwapped,
			children: [],
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

	const moveListAt = (cursorId: NodeId): MoveData[] => {
		let cur = cursorId;
		const out: MoveData[] = [];
		while (cur !== historyRootId) {
			const n = nodeAt(cur);
			if (n.move?.kind === "stone") out.push(n.move.coords);
			if (n.parent === null) break;
			cur = n.parent;
		}
		out.reverse();
		return out;
	};

	const setRealCursor = (next: NodeId): void => {
		realCursorId = next;
		if (playerMode === 1 || !isPreviewMode) {
			activeCursorId = next;
			hoverCursorId = null;
		}
	};

	const setActiveCursor = (next: NodeId): void => {
		activeCursorId = next;
		hoverCursorId = null;
	};

	const realMoveCount = $derived(nodeAt(realCursorId).stonePly);
	const activeMoveCount = $derived(nodeAt(activeCursorId).stonePly);
	const isPreviewEnabled = $derived(playerMode !== 1 && isPreviewMode);
	const isHistoryClickEnabled = $derived(playerMode === 1 || isPreviewEnabled);
	const displayCursorId = $derived(hoverCursorId ?? activeCursorId);
	const displayMoves = $derived(moveListAt(displayCursorId));
	const displayMoveCount = $derived(nodeAt(displayCursorId).stonePly);
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
			hoverCursorId === null &&
			(playerMode === 1 || isPreviewEnabled || (connected && myTurn)),
	);

	$effect(() => {
		moves = moveListAt(realCursorId);
	});

	$effect(() => {
		if (!isPreviewEnabled) return;
		lastPreviewCursorId = activeCursorId;
	});

	let wasPreviewEnabled = $state(false);
	$effect(() => {
		if (playerMode === 1) {
			isPreviewMode = false;
			lastPreviewCursorId = realCursorId;
			activeCursorId = realCursorId;
			hoverCursorId = null;
			wasPreviewEnabled = false;
			return;
		}

		if (!isPreviewEnabled) {
			if (wasPreviewEnabled) lastPreviewCursorId = activeCursorId;
			activeCursorId = realCursorId;
			hoverCursorId = null;
		} else if (!wasPreviewEnabled) {
			const candidate = historyNodes[lastPreviewCursorId]
				? lastPreviewCursorId
				: realCursorId;
			setActiveCursor(candidate);
		}

		wasPreviewEnabled = isPreviewEnabled;
	});

	const setPreviewMode = (next: boolean): void => {
		if (playerMode === 1) return;
		if (!next && isPreviewEnabled) lastPreviewCursorId = activeCursorId;
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
	let turnTextColor = $derived(readableTextColorOn(turnColor).fill);
	let turnText = $derived(
		(() => {
			if (playerMode === 1) return `Turn: P${turnPlayer}`;
			if (effectivePlayer === null) return "Turn: —";
			return myTurn ? "Turn: YOURS" : "Turn: THEIRS";
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
		};
		const onKeyUp = (e: KeyboardEvent) => {
			if (e.key === "Shift") isShiftHeld = false;
			if (e.key === "Control") setPreviewMode(false);
		};
		const onBlur = () => {
			isShiftHeld = false;
			setPreviewMode(false);
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
		const borderPx = Math.max(0, Number.parseFloat(style.borderTopWidth) || 0) * dpr;

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

		const radial = ctx.createRadialGradient(wPx * 0.2, hPx * 0.18, 0, wPx * 0.2, hPx * 0.18, Math.max(wPx, hPx) * 0.7);
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
		const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
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
					"coords" in u &&
					isMoveData((u as { kind: "stone"; coords: unknown }).coords)
				);
			case "swap":
				return true;
			default:
				return false;
		}
	};

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
		return true;
	};

	type PersistedStateV1 = {
		v: 1;
		size: number;
		historyNodes: (HistoryNode | null)[];
		historyRootId: NodeId;
		historyNextId: NodeId;
		realCursorId: NodeId;
		activeCursorId: NodeId;
		lastPreviewCursorId: NodeId;
	};

	let hasLoadedPersistedState = $state(false);
	$effect(() => {
		if (typeof window === "undefined") return;
		if (hasLoadedPersistedState) return;
		hasLoadedPersistedState = true;

		const root = historyNodes[historyRootId];
		const isFresh =
			!!root &&
			root.kind === "root" &&
			root.children.length === 0 &&
			historyNextId === 1 &&
			realCursorId === historyRootId;
		if (!isFresh) return;

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
			return;
		}
		if (!raw) return;

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
			return;
		}
		if (typeof parsed !== "object" || parsed === null) return;
		if (!("v" in parsed) || (parsed as PersistedStateV1).v !== 1) return;

		const typed = parsed as PersistedStateV1;
		if (!isValidBoardSize(typed.size)) return;
		if (!Array.isArray(typed.historyNodes)) return;
		if (!isNodeId(typed.historyRootId)) return;
		if (!isNodeId(typed.historyNextId)) return;
		if (!isNodeId(typed.realCursorId)) return;
		if (!isNodeId(typed.activeCursorId)) return;
		if (!isNodeId(typed.lastPreviewCursorId)) return;

		const nodes = typed.historyNodes;
		if (nodes.length === 0) return;
		if (!nodes.every((n) => n === null || isHistoryNode(n))) return;
		if (typed.historyRootId !== 0) return;
		if (!nodes[0] || nodes[0].kind !== "root") return;

		const hasNodeAt = (id: NodeId): boolean => !!nodes[id];
		if (!hasNodeAt(typed.realCursorId)) return;
		if (!hasNodeAt(typed.activeCursorId)) return;
		if (!hasNodeAt(typed.lastPreviewCursorId)) return;

		size = typed.size;
		historyNodes = nodes;
		historyRootId = typed.historyRootId;
		historyNextId = typed.historyNextId;
		realCursorId = typed.realCursorId;
		activeCursorId = typed.activeCursorId;
		lastPreviewCursorId = typed.lastPreviewCursorId;
		hoverCursorId = null;
	});

	let persistGameStateTimer: number | null = $state(null);
	$effect(() => {
		if (typeof window === "undefined") return;

		const snapshot: PersistedStateV1 = {
			v: 1,
			size,
			historyNodes,
			historyRootId,
			historyNextId,
			realCursorId,
			activeCursorId,
			lastPreviewCursorId,
		};
		const key = gameStateStorageKey;

		if (persistGameStateTimer !== null) {
			window.clearTimeout(persistGameStateTimer);
			persistGameStateTimer = null;
		}

		persistGameStateTimer = window.setTimeout(() => {
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

			let ok2: boolean;
			let err2: unknown;
			try {
				localStorage.setItem(key, json);
				ok2 = true;
			} catch (e) {
				err2 = e;
				ok2 = false;
			}
			if (!ok2) console.warn("failed to persist game state", err2);
		}, 160);

		return () => {
			if (persistGameStateTimer === null) return;
			window.clearTimeout(persistGameStateTimer);
			persistGameStateTimer = null;
		};
	});

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
				if (isMoveData(typed.data)) return typed;
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
			case "undo":
			case "swap":
				return typed;
			default:
				ensureCoverage(typed);
				return new Bad("ServerMessage.type is invalid");
		}
	};

	const send = (ws: WebSocket, message: InnerClientMessage): void => {
		if (id !== null) ws.send(JSON.stringify({ id, message }));
		else console.error("id is null");
	};

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
							setRealCursor(advanceFrom(realCursorId, msg.data));
							break;
						case "set size":
							size = msg.data;
							resetHistory();
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
								const parent = nodeAt(realCursorId).parent;
								if (parent !== null) setRealCursor(parent);
							}
							break;
						case "swap":
							{
								const cur = nodeAt(realCursorId);
								if (cur.stonePly === 1 && !cur.playersSwapped)
									setRealCursor(advanceSwapFrom(realCursorId));
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
		setRealCursor(cur.parent);
	};

	const undoActive = (): void => {
		const cur = nodeAt(activeCursorId);
		if (cur.parent === null) return;
		setActiveCursor(cur.parent);
	};

	const swapReal = (): void => {
		const cur = nodeAt(realCursorId);
		if (cur.stonePly !== 1) return;
		if (cur.playersSwapped) return;
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
	let movesForRender = $derived(
		displayMoves.map((coords, i) => ({ coords, i })),
	);
	let movesForStones = $derived(movesForRender.toReversed());
	let componentOutlineHalfWidth = $derived(
		svgPixels && svgPixels.w > 0
			? viewBox.w / svgPixels.w / 2
			: viewBox.w / 800,
	);
	let componentOutlineFilterMargin = $derived(
		Math.max(componentOutlineHalfWidth * 8, viewBox.w / 200),
	);

	const handleWheel = (e: WheelEvent): void => {
		updateMouseLocImmediately(e);

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
			if (hoverCursorId !== null) return;

			if (playerMode === 1) {
				setRealCursor(advanceFrom(realCursorId, mouseLoc));
				return;
			}

			if (isPreviewEnabled) {
				setActiveCursor(advanceFrom(activeCursorId, mouseLoc));
				return;
			}

			if (myTurn && connected) {
				setRealCursor(advanceFrom(realCursorId, mouseLoc));
				send(playerMode.socket, { type: "move", data: mouseLoc });
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

	const setHoverCursor = (next: NodeId | null): void => {
		hoverCursorId = next;
	};

	const selectHistoryNode = (next: NodeId): void => {
		if (!isHistoryClickEnabled) return;

		if (playerMode === 1) {
			setRealCursor(next);
			activeCursorId = next;
			return;
		}

		if (isPreviewEnabled) setActiveCursor(next);
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

	const deleteHistoryNode = (id: NodeId): void => {
		if (!canDeleteHistoryNode(id)) return;

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
		if (hoverCursorId !== null && deleted.has(hoverCursorId))
			hoverCursorId = null;
		if (deleted.has(activeCursorId)) activeCursorId = parentId;
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
						<rect
							x={move.coords[0] - 3 / 2}
							y={move.coords[1] - 3 / 2}
							width="3"
							height="3"
							fill={playerColor(playerFromIndex(move.i))}
							fill-opacity="0.16"
						></rect>
					{/each}
				{/if}

				{#snippet shape(
					coords: [number, number],
					index: number,
					isHighlighted: boolean,
					opacity: number,
				)}
					<rect
						x={coords[0] - 1 / 2}
						y={coords[1] - 1 / 2}
						width="1"
						height="1"
						fill={playerColor(playerFromIndex(index))}
						fill-opacity={opacity}
						stroke={isHighlighted ? "black" : "none"}
						stroke-width={isHighlighted ? 2 : 0}
						vector-effect="non-scaling-stroke"
					></rect>
				{/snippet}

				{#if isPreviewStoneShown}
					{@render shape(mouseLoc, displayMoveCount, false, 0.75)}
				{/if}

				{#each movesForStones as move (move.i)}
					{@render shape(
						move.coords,
						move.i,
						false,
						1,
					)}
				{/each}

				{#if isShiftHeld && displayMoveCount > 0 && svgPixels && svgPixels.w > 0}
					{@const latestCoords = displayMoves[displayMoveCount - 1]}
					{@const unitsPerPx = viewBox.w / svgPixels.w}
					{@const t = unitsPerPx * 2}
					{#if latestCoords}
						<path
							d={`M ${latestCoords[0] - 1 / 2 - t} ${latestCoords[1] - 1 / 2 - t} h ${1 + 2 * t} v ${1 + 2 * t} h ${-(1 + 2 * t)} Z M ${latestCoords[0] - 1 / 2} ${latestCoords[1] - 1 / 2} h 1 v 1 h -1 Z`}
							fill="rgba(0,0,0,0.95)"
							fill-rule="evenodd"
							style:pointer-events="none"
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

						<mask id="p1ComponentMask" maskUnits="userSpaceOnUse">
							{#each movesForRender as move (move.i)}
								{#if playerFromIndex(move.i) === 1}
									<rect
										x={move.coords[0] - 1 / 2}
										y={move.coords[1] - 1 / 2}
										width="1"
										height="1"
										fill="white"
									></rect>
								{/if}
							{/each}
						</mask>
						<mask id="p2ComponentMask" maskUnits="userSpaceOnUse">
							{#each movesForRender as move (move.i)}
								{#if playerFromIndex(move.i) === 2}
									<rect
										x={move.coords[0] - 1 / 2}
										y={move.coords[1] - 1 / 2}
										width="1"
										height="1"
										fill="white"
									></rect>
								{/if}
							{/each}
						</mask>
					</defs>

					<g pointer-events="none">
						<rect
							x="0"
							y="0"
							width={size}
							height={size}
							fill="black"
							mask="url(#p1ComponentMask)"
							filter="url(#componentOutlineFilter)"
						></rect>
						<rect
							x="0"
							y="0"
							width={size}
							height={size}
							fill="black"
							mask="url(#p2ComponentMask)"
							filter="url(#componentOutlineFilter)"
						></rect>
					</g>
				{/if}

				{#if isShiftHeld}
					{#each movesForRender as move (move.i)}
						{@const indexTextStyle = stoneIndexTextStyle(move.i)}
						<text
							x={move.coords[0]}
							y={move.coords[1]}
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
				turnTextColor={turnTextColor}
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
			onpointerleave={() => setHoverCursor(null)}
		>
			<div class="historyHeader">
				<div>game tree</div>
				{#if playerMode !== 1 && isPreviewEnabled}
					<div class="ctrlHeld" title="Preview mode (holding ctrl)">CTRL HELD</div>
				{/if}
			</div>
			<HistoryTree
				nodes={historyNodes}
				rootId={historyRootId}
				{realCursorId}
				{realPathById}
				{activeCursorId}
				{hoverCursorId}
				isHoverEnabled={true}
				isClickEnabled={isHistoryClickEnabled}
				setHover={setHoverCursor}
				select={selectHistoryNode}
				canDelete={canDeleteHistoryNode}
				del={deleteHistoryNode}
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
