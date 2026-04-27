<script lang="ts">
	type NodeId = number;
	type HistoryNode = {
		id: NodeId;
		parent: NodeId | null;
		ply: number;
		children: NodeId[];
	};

	type Props = {
		nodes: (HistoryNode | null)[];
		rootId: NodeId;
		realCursorId: NodeId;
		realPathById: Record<number, true>;
		activeCursorId: NodeId;
		hoverCursorId: NodeId | null;
		isHoverEnabled: boolean;
		isClickEnabled: boolean;

		setHover: (id: NodeId | null) => void;
		select: (id: NodeId) => void;
		canDelete: (id: NodeId) => boolean;
		del: (id: NodeId) => void;
	};

	let {
		nodes,
		rootId,
		realCursorId,
		realPathById,
		activeCursorId,
		hoverCursorId,
		isHoverEnabled,
		isClickEnabled,
		setHover,
		select,
		canDelete,
		del,
	}: Props = $props();

	const xStep = 28;
	const yStep = 18;
	const margin = 10;
	const r = 6;

	type Pos = { x: number; y: number };

	let nodeIds = $derived(
		(() => {
			const out: NodeId[] = [];
			const seen = new Set<NodeId>();
			const stack: NodeId[] = [rootId];

			while (stack.length > 0) {
				const id = stack.pop();
				if (id === undefined) break;
				if (seen.has(id)) continue;
				seen.add(id);

				const n = nodes[id];
				if (!n) continue;
				out.push(id);

				for (let i = n.children.length - 1; i >= 0; i -= 1) {
					stack.push(n.children[i]!);
				}
			}

			out.sort((a, b) => a - b);
			return out;
		})(),
	);

	let maxPly = $derived(
		nodeIds.reduce((m, id) => Math.max(m, nodes[id]?.ply ?? 0), 0),
	);

	let { positions, maxLeafIndex } = $derived(
		((): { positions: Record<number, Pos>; maxLeafIndex: number } => {
			const yIndexById: Record<number, number> = {};
			let nextLeafIndex = 0;

			const assignY = (id: NodeId): number => {
				const n = nodes[id];
				if (!n) return nextLeafIndex;

				const children = n.children.filter((childId) => !!nodes[childId]);
				if (children.length === 0) {
					const y = nextLeafIndex;
					nextLeafIndex += 1;
					yIndexById[id] = y;
					return y;
				}

				const childYs = children.map(assignY).sort((a, b) => a - b);
				const y = (childYs[0]! + childYs[childYs.length - 1]!) / 2;
				yIndexById[id] = y;
				return y;
			};

			assignY(rootId);

			const out: Record<number, Pos> = {};
			for (const id of nodeIds) {
				const n = nodes[id];
				if (!n) continue;
				const yIndex = yIndexById[id] ?? 0;
				out[id] = {
					x: margin + n.ply * xStep,
					y: margin + yIndex * yStep,
				};
			}

			return { positions: out, maxLeafIndex: Math.max(1, nextLeafIndex) };
		})(),
	);
	let svgWidth = $derived(margin * 2 + (maxPly + 1) * xStep);
	let svgHeight = $derived(margin * 2 + maxLeafIndex * yStep);

	const isRoot = (id: NodeId): boolean => id === rootId;
	const isOnRealPath = (id: NodeId): boolean => !!realPathById[id];
	const isReal = (id: NodeId): boolean => id === realCursorId;
	const isActive = (id: NodeId): boolean => id === activeCursorId;
	const isHovered = (id: NodeId): boolean => hoverCursorId === id;
</script>

<div class="treeWrap" class:isInteractive={isClickEnabled}>
	<div class="treeScroll">
		<svg
			class="treeSvg"
			viewBox={`0 0 ${svgWidth} ${svgHeight}`}
			preserveAspectRatio="xMinYMin meet"
			oncontextmenu={(e) => {
				e.preventDefault();
				e.stopPropagation();
			}}
		>
			{#each nodeIds as id (id)}
				{@const n = nodes[id]}
				{#if n && n.parent !== null}
					{@const p = positions[n.parent]}
					{@const c = positions[id]}
					{#if p && c}
						<line
							x1={p.x}
							y1={p.y}
							x2={c.x}
							y2={c.y}
							stroke="rgba(0,0,0,0.28)"
							stroke-width="1"
							vector-effect="non-scaling-stroke"
						></line>
					{/if}
				{/if}
			{/each}

			{#each nodeIds as id (id)}
				{@const pos = positions[id]}
				{@const n = nodes[id]}
				{#if pos && n}
					<g
						transform={`translate(${pos.x} ${pos.y})`}
						class="node"
						class:root={isRoot(id)}
						class:real={isReal(id)}
						class:active={isActive(id)}
						class:hovered={isHovered(id)}
						onpointerenter={() => (isHoverEnabled ? setHover(id) : undefined)}
						onpointerdown={(e) => {
							if (e.button !== 2) return;
							e.preventDefault();
							e.stopPropagation();
							if (!canDelete(id)) return;
							del(id);
						}}
						role="button"
						tabindex={isClickEnabled ? 0 : -1}
						onclick={(e) => {
							e.preventDefault();
							if (!isClickEnabled) return;
							select(id);
						}}
						onkeydown={(e) => {
							if (!isClickEnabled) return;
							if (e.key !== "Enter" && e.key !== " ") return;
							e.preventDefault();
							select(id);
						}}
						oncontextmenu={(e) => {
							e.preventDefault();
							if (!canDelete(id)) return;
							del(id);
						}}
						style:cursor={isClickEnabled || canDelete(id) ? "pointer" : "default"}
					>
						<title>
							{isClickEnabled
								? canDelete(id)
									? "Hover: preview • Left click: jump • Right click: delete branch"
									: "Hover: preview • Left click: jump"
								: canDelete(id)
									? "Hover: preview • Right click: delete branch • Hold ctrl for preview mode"
									: "Hover: preview • Hold ctrl for preview mode"}
						</title>
						<circle
							cx="0"
							cy="0"
							{r}
							fill={isRoot(id)
								? "rgba(0,0,0,0.16)"
								: isOnRealPath(id)
									? "rgba(0,0,0,0.06)"
									: "rgba(255,255,255,0.92)"}
							stroke={isReal(id) ? "black" : "rgba(0,0,0,0.25)"}
							stroke-width={isReal(id) ? 2 : 1}
							vector-effect="non-scaling-stroke"
						></circle>
						{#if isActive(id) && !isReal(id)}
							<circle
								cx="0"
								cy="0"
								r={r + 2}
								fill="none"
								stroke="rgba(30,58,138,0.9)"
								stroke-width="2"
								vector-effect="non-scaling-stroke"
							></circle>
						{/if}
						{#if isHovered(id)}
							<circle
								cx="0"
								cy="0"
								r={r + 4}
								fill="none"
								stroke="rgba(0,0,0,0.18)"
								stroke-width="2"
								vector-effect="non-scaling-stroke"
							></circle>
						{/if}
					</g>
				{/if}
			{/each}
		</svg>
	</div>
</div>

<style>
	.treeWrap {
		margin-top: 10px;
		border-radius: 10px;
		padding: 10px;
		border: 1px solid rgba(0, 0, 0, 0.08);
		background: rgba(255, 255, 255, 0.55);
	}

	.treeScroll {
		overflow-x: auto;
		overflow-y: hidden;
		-webkit-overflow-scrolling: touch;
	}

	.treeSvg {
		display: block;
		width: 100%;
		min-width: 260px;
		height: 140px;
	}

	.node.root circle:first-child {
		stroke: rgba(0, 0, 0, 0.25);
	}

	.treeWrap:not(.isInteractive) {
		opacity: 0.8;
	}
</style>
