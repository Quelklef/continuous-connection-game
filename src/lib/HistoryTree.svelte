<script lang="ts">
	import type { StableKey } from "../../shared/types.ts";

	type RenderNode = {
		key: StableKey;
		parentKey: StableKey | null;
		ply: number;
		kind: "root" | "stone" | "swap";
		layer: "baseline" | "shared";
	};

	type Props = {
		nodes: RenderNode[];
		rootKey: StableKey;
		realKey: StableKey;
		realPathByKey: Record<string, true>;
		activeKey: StableKey;
		hoverKey: StableKey | null;
		isHoverEnabled: boolean;
		isClickEnabled: boolean;
		isSaveShown: boolean;
		saveTitle: string;
		save: () => void;

		setHover: (key: StableKey | null) => void;
		select: (key: StableKey) => void;
		canDelete: (key: StableKey) => boolean;
		del: (key: StableKey) => void;
	};

	let {
		nodes,
		rootKey,
		realKey,
		realPathByKey,
		activeKey,
		hoverKey,
		isHoverEnabled,
		isClickEnabled,
		isSaveShown,
		saveTitle,
		save,
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

	const nodesByKey = $derived(
		(() => {
			const out = new Map<StableKey, RenderNode>();
			for (const n of nodes) out.set(n.key, n);
			return out;
		})(),
	);

	const childrenByKey = $derived(
		(() => {
			const out: Record<string, StableKey[]> = {};
			for (const n of nodes) {
				if (n.parentKey === null) continue;
				const k = n.parentKey;
				const existing = out[k] ?? [];
				existing.push(n.key);
				out[k] = existing;
			}
			for (const k of Object.keys(out))
				out[k] = (out[k] ?? []).toSorted((a, b) => a.localeCompare(b));
			return out;
		})(),
	);

	let nodeKeys = $derived(
		(() => {
			const out: StableKey[] = [];
			const seen = new Set<StableKey>();
			const stack: StableKey[] = [rootKey];

			while (stack.length > 0) {
				const key = stack.pop();
				if (key === undefined) break;
				if (seen.has(key)) continue;
				seen.add(key);

				const n = nodesByKey.get(key);
				if (!n) continue;
				out.push(key);

				const children = childrenByKey[key] ?? [];
				for (let i = children.length - 1; i >= 0; i -= 1) {
					stack.push(children[i]!);
				}
			}

			out.sort((a, b) => {
				const ap = nodesByKey.get(a)?.ply ?? 0;
				const bp = nodesByKey.get(b)?.ply ?? 0;
				return ap - bp || a.localeCompare(b);
			});
			return out;
		})(),
	);

	let maxPly = $derived(
		nodeKeys.reduce((m, k) => Math.max(m, nodesByKey.get(k)?.ply ?? 0), 0),
	);

	let { positions, maxLeafIndex } = $derived(
		((): { positions: Record<string, Pos>; maxLeafIndex: number } => {
			const yIndexByKey: Record<string, number> = {};
			let nextLeafIndex = 0;

			const assignY = (key: StableKey): number => {
				const n = nodesByKey.get(key);
				if (!n) return nextLeafIndex;

				const children = (childrenByKey[key] ?? []).filter((childKey) =>
					nodesByKey.has(childKey),
				);
				if (children.length === 0) {
					const y = nextLeafIndex;
					nextLeafIndex += 1;
					yIndexByKey[key] = y;
					return y;
				}

				const childYs = children.map(assignY).sort((a, b) => a - b);
				const y = (childYs[0]! + childYs[childYs.length - 1]!) / 2;
				yIndexByKey[key] = y;
				return y;
			};

			assignY(rootKey);

			const out: Record<string, Pos> = {};
			for (const key of nodeKeys) {
				const n = nodesByKey.get(key);
				if (!n) continue;
				const yIndex = yIndexByKey[key] ?? 0;
				out[key] = {
					x: margin + n.ply * xStep,
					y: margin + yIndex * yStep,
				};
			}

			return { positions: out, maxLeafIndex: Math.max(1, nextLeafIndex) };
		})(),
	);
	let svgWidth = $derived(margin * 2 + (maxPly + 1) * xStep);
	let svgHeight = $derived(margin * 2 + maxLeafIndex * yStep);

	const isRoot = (key: StableKey): boolean => key === rootKey;
	const isOnRealPath = (key: StableKey): boolean => !!realPathByKey[key];
	const isReal = (key: StableKey): boolean => key === realKey;
	const isActive = (key: StableKey): boolean => key === activeKey;
	const isHovered = (key: StableKey): boolean => hoverKey === key;
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
			{#each nodeKeys as key (key)}
				{@const n = nodesByKey.get(key)}
				{#if n && n.parentKey !== null}
					{@const p = positions[n.parentKey]}
					{@const c = positions[key]}
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

			{#each nodeKeys as key (key)}
				{@const pos = positions[key]}
				{@const n = nodesByKey.get(key)}
				{#if pos && n}
					<g
						transform={`translate(${pos.x} ${pos.y})`}
						class="node"
						class:root={isRoot(key)}
						class:swap={n.kind === "swap"}
						class:shared={n.layer === "shared"}
						class:real={isReal(key)}
						class:active={isActive(key)}
						class:hovered={isHovered(key)}
						onpointerenter={() => (isHoverEnabled ? setHover(key) : undefined)}
						onpointerdown={(e) => {
							if (e.button !== 2) return;
							e.preventDefault();
							e.stopPropagation();
							if (!canDelete(key)) return;
							del(key);
						}}
						role="button"
						tabindex={isClickEnabled ? 0 : -1}
						onclick={(e) => {
							e.preventDefault();
							if (!isClickEnabled) return;
							select(key);
						}}
						onkeydown={(e) => {
							if (!isClickEnabled) return;
							if (e.key !== "Enter" && e.key !== " ") return;
							e.preventDefault();
							select(key);
						}}
						oncontextmenu={(e) => {
							e.preventDefault();
							if (!canDelete(key)) return;
							del(key);
						}}
						style:cursor={isClickEnabled || canDelete(key)
							? "pointer"
							: "default"}
					>
						<title>
							{isClickEnabled
								? canDelete(key)
									? "Hover: preview • Left click: jump • Right click: delete branch"
									: "Hover: preview • Left click: jump"
								: canDelete(key)
									? "Hover: preview • Right click: delete branch • Hold ctrl for preview mode"
									: "Hover: preview • Hold ctrl for preview mode"}
						</title>
						<circle
							cx="0"
							cy="0"
							{r}
							fill={isRoot(key)
								? "rgba(0,0,0,0.16)"
								: isOnRealPath(key)
									? "rgba(0,0,0,0.06)"
									: "rgba(255,255,255,0.92)"}
							stroke={isReal(key) ? "black" : "rgba(0,0,0,0.25)"}
							stroke-width={isReal(key) ? 2 : 1}
							vector-effect="non-scaling-stroke"
						></circle>
						{#if isSaveShown && isActive(key)}
							<g
								class="saveBtn"
								transform={`translate(${r + 8} ${-(r + 8)})`}
								role="button"
								tabindex={0}
								onpointerdown={(e) => {
									e.preventDefault();
									e.stopPropagation();
									save();
								}}
								onclick={(e) => {
									e.preventDefault();
									e.stopPropagation();
									save();
								}}
								onkeydown={(e) => {
									if (e.key !== "Enter" && e.key !== " ") return;
									e.preventDefault();
									e.stopPropagation();
									save();
								}}
							>
								<title>{saveTitle}</title>
								<circle
									cx="0"
									cy="0"
									r="7"
									fill="rgba(30,58,138,0.95)"
									stroke="rgba(255,255,255,0.7)"
									stroke-width="1.5"
									vector-effect="non-scaling-stroke"
								></circle>
								<path
									d="M-3.2-3.4h6.4l1.6 1.7V4.2c0 .7-.6 1.3-1.3 1.3h-7.4c-.7 0-1.3-.6-1.3-1.3v-6.3c0-.7.6-1.3 1.3-1.3Zm.4 1.6v2h4.4v-2h-4.4Zm0 3.3v2h4.4v-2h-4.4Z"
									fill="white"
									opacity="0.95"
								/>
							</g>
						{/if}
						{#if isActive(key) && !isReal(key)}
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
						{#if isHovered(key)}
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

	.node.swap circle:first-child {
		stroke-dasharray: 3 2;
	}

	.node.shared circle:first-child {
		stroke: rgba(30, 58, 138, 0.55);
		fill: rgba(220, 233, 255, 0.58);
	}

	.saveBtn {
		cursor: pointer;
	}

	.saveBtn:hover {
		transform: translateY(-1px);
	}

	.treeWrap:not(.isInteractive) {
		opacity: 0.8;
	}
</style>
