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

	const setMouseLoc = (e: MouseEvent): void => {
		const p = new DOMPoint(e.clientX, e.clientY);
		const { x, y } = p.matrixTransform(svg.getScreenCTM()?.inverse());
		mouseLoc = [x, y];
	};

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
</script>

<div
	style:display="flex"
	style:justify-content="center"
	style:align-items="center"
	style:flex-direction="column"
>
	<svg
		bind:this={svg}
		viewBox={`0 0 ${size} ${size}`}
		onmouseenter={(e) => {
			mouseLoc = [e.pageX, e.pageY];
			mouseOver = true;
		}}
		onmouseleave={() => (mouseOver = false)}
		onmousemove={setMouseLoc}
		onmousedown={(e) => {
			setMouseLoc(e);
			if (playerMode === 1) {
				moves.push(mouseLoc);
			} else if (myTurn && connected) {
				moves.push(mouseLoc);
				send(playerMode.socket, { type: "move", data: mouseLoc });
			}
		}}
		style:width="min(90vh,90vw)"
		style:height="min(90vh,90vw)"
		style:border="10px solid"
		style:border-color="red blue"
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
