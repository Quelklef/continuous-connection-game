<script lang="ts">
	import { Bad, ensureCoverage } from "../../shared/lib.ts";
	import type {
		ServerMessage,
		InnerClientMessage,
		MoveData,
		Player,
	} from "../../shared/types.ts";
	type Props = {
		size: number;
		moves: MoveData[];
		playerMode?: 1 | { socket: WebSocket };
	};
	let { size, moves = $bindable(), playerMode = 1 }: Props = $props();

	type ViewBox = { x: number; y: number; w: number; h: number };
	const clamp = (v: number, min: number, max: number): number =>
		Math.min(max, Math.max(min, v));

	const minViewBoxSize = 2;
	let viewBox: ViewBox = $state({ x: 0, y: 0, w: 0, h: 0 });
	let isViewBoxInitialized = $state(false);
	let viewBoxStr = $derived(
		`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`,
	);

	let mouseLoc: [number, number] = $state([0, 0]);
	let index: number = $derived(moves.length);
	let mouseOver = $state(false);
	let connected = false;
	let id: number | null = null;
	let player: Player | null = $state(null);
	let swapped: boolean = $state(false);
	let svg: SVGSVGElement;

	const playerFromIndex = (index: number): Player => {
		return index % 2 === 0 ? 1 : 2;
	};

	let myTurn = $derived(playerMode === 1 || playerFromIndex(index) === player);

	const playerColor = (player: Player): string => {
		switch (player) {
			case 1:
				return "red";
			case 2:
				return "blue";
		}
	};

	const updateMouseLoc = (e: PointerEvent | WheelEvent): void => {
		if (!svg) return;

		const ctm = svg.getScreenCTM();
		if (!ctm) return;

		const p = new DOMPoint(e.clientX, e.clientY);
		const { x, y } = p.matrixTransform(ctm.inverse());
		mouseLoc = [x, y];
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

	type PanSession = {
		startClient: [number, number];
		startViewBox: ViewBox;
	};
	let panSession: PanSession | null = $state(null);

	$effect(() => {
		if (isViewBoxInitialized) return;
		viewBox = { x: 0, y: 0, w: size, h: size };
		isViewBoxInitialized = true;
	});

	const parseWs = (data: string): ServerMessage | Bad => {
		try {
			const parsed = JSON.parse(data) as ServerMessage;
			switch (parsed.type) {
				case "move":
					if (
						typeof parsed.data[0] === "number" &&
						typeof parsed.data[1] === "number"
					)
						return parsed;
					else return new Bad("'move' type has incorrect data");
				case "assign id":
					if (typeof parsed.data === "number") return parsed;
					else return new Bad("assign id gone wrong");
				case "assign player":
					if (typeof parsed.data === "number") return parsed;
					else return new Bad("assign player gone wrong");
				case "full":
				case "undo":
				case "swap":
					return parsed;
				default:
					ensureCoverage(parsed);
					return new Bad(`not of type ServerMessage`);
			}
		} catch (e) {
			return new Bad("JSON did not parse");
		}
	};

	const send = (ws: WebSocket, message: InnerClientMessage): void => {
		if (id !== null) ws.send(JSON.stringify({ id, message }));
		else console.error("id is null");
	};

	$effect(() => {
		if (playerMode !== 1) {
			playerMode.socket.addEventListener("open", () => (connected = true));
			playerMode.socket.addEventListener("message", (e) => {
				const result = parseWs(e.data);
				Bad.handle(
					result,
					(msg) => {
						switch (msg.type) {
							case "move":
								moves.push(msg.data);
								break;
							case "full":
								break;
							case "assign id":
								id = msg.data;
								break;
							case "assign player":
								player = msg.data;
								break;
							case "undo":
								undo();
								break;
							case "swap":
								swap();
								break;
							default:
								ensureCoverage(msg);
						}
					},
					console.warn,
				);
			});
		}
	});

	const undo = (): void => {
		moves.pop();
		swapped = false;
	};

	const swap = () => {
		if (moves.length === 1 && !swapped) {
			swapped = true;
			if (player === 1) player = 2;
			else player = 1;
		}
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
		!isZoomedIn || isButtingLeft ? "blue" : "black",
	);
	let borderTopColor = $derived(!isZoomedIn || isButtingTop ? "red" : "black");
	let borderRightColor = $derived(
		!isZoomedIn || isButtingRight ? "blue" : "black",
	);
	let borderBottomColor = $derived(
		!isZoomedIn || isButtingBottom ? "red" : "black",
	);

	const handleWheel = (e: WheelEvent): void => {
		updateMouseLoc(e);

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

		updateMouseLoc(e);

		if (e.button === 2) {
			panSession = {
				startClient: [e.clientX, e.clientY],
				startViewBox: { ...viewBox },
			};
			svg.setPointerCapture(e.pointerId);
			return;
		}

		if (e.button === 0) {
			if (playerMode === 1) {
				moves.push(mouseLoc);
			} else if (myTurn && connected) {
				moves.push(mouseLoc);
				send(playerMode.socket, { type: "move", data: mouseLoc });
			}
		}
	};

	const handlePointerMove = (e: PointerEvent): void => {
		if (!svg || !panSession) {
			updateMouseLoc(e);
			return;
		}

		const rect = svg.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return;

		const [startClientX, startClientY] = panSession.startClient;
		const dx = e.clientX - startClientX;
		const dy = e.clientY - startClientY;

		const unitsPerPixelX = panSession.startViewBox.w / rect.width;
		const unitsPerPixelY = panSession.startViewBox.h / rect.height;

		viewBox = clampViewBox({
			...panSession.startViewBox,
			x: panSession.startViewBox.x - dx * unitsPerPixelX,
			y: panSession.startViewBox.y - dy * unitsPerPixelY,
		});

		updateMouseLoc(e);
	};

	const handlePointerUpOrCancel = (): void => {
		panSession = null;
	};
</script>

<div
	style:display="flex"
	style:justify-content="center"
	style:align-items="center"
	style:flex-direction="column"
>
	<svg
		bind:this={svg}
		viewBox={viewBoxStr}
		oncontextmenu={(e) => e.preventDefault()}
		onpointerenter={(e) => {
			updateMouseLoc(e);
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
		style:width="min(90vh,90vw)"
		style:height="min(90vh,90vw)"
		style:border="10px solid"
		style:border-left-color={borderLeftColor}
		style:border-top-color={borderTopColor}
		style:border-right-color={borderRightColor}
		style:border-bottom-color={borderBottomColor}
	>
		{#snippet shape(coords: [number, number], index: number)}
			<rect
				x={coords[0] - 1 / 2}
				y={coords[1] - 1 / 2}
				width="1"
				height="1"
				fill={playerColor(playerFromIndex(index))}
			></rect>
		{/snippet}

		{#if myTurn && mouseOver}
			{@render shape(mouseLoc, index)}
		{/if}

		{#each [...moves]
			.map((v, i): [MoveData, number] => [v, i])
			.reverse() as move}
			{@render shape(move[0], move[1])}
		{/each}
	</svg>
	<button
		disabled={playerMode !== 1 && myTurn}
		onclick={() => {
			undo();
			if (playerMode !== 1) send(playerMode.socket, { type: "undo" });
		}}>undo</button
	>
	{#if playerMode !== 1}
		<button
			disabled={moves.length !== 1 || !myTurn || swapped}
			onclick={() => {
				swap();
				send(playerMode.socket, { type: "swap" });
			}}>swap</button
		>
	{/if}
</div>
