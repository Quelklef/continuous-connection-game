import type { MoveData } from "../../../shared/types.ts";
import type { StableKey } from "../history/stableKey";
import { appendKey, parentKeyOf } from "../history/stableKey";

export type OverlayMove =
	| { kind: "stone"; coords: MoveData }
	| { kind: "swap" };

export type OverlayNode = {
	key: StableKey;
	parentKey: StableKey;
	move: OverlayMove;
	kind: OverlayMove["kind"];
};

export type OverlayState = {
	nodesByKey: Map<StableKey, OverlayNode>;
	childrenByParentKey: Map<StableKey, StableKey[]>;
};

export const emptyOverlayState = (): OverlayState => ({
	nodesByKey: new Map(),
	childrenByParentKey: new Map(),
});

export const overlayHas = (state: OverlayState, key: StableKey): boolean =>
	state.nodesByKey.has(key);

export const overlayGet = (
	state: OverlayState,
	key: StableKey,
): OverlayNode | null => state.nodesByKey.get(key) ?? null;

export const overlayUpsertAdd = (
	state: OverlayState,
	parentKey: StableKey,
	move: OverlayMove,
): { key: StableKey; changed: boolean } => {
	const key = appendKey(parentKey, move);
	if (state.nodesByKey.has(key)) return { key, changed: false };

	const node: OverlayNode = {
		key,
		parentKey,
		move,
		kind: move.kind,
	};
	state.nodesByKey.set(key, node);

	const existing = state.childrenByParentKey.get(parentKey) ?? [];
	if (!existing.includes(key)) existing.push(key);
	state.childrenByParentKey.set(parentKey, existing);
	return { key, changed: true };
};

export const overlaySubtreeKeys = (
	state: OverlayState,
	rootKey: StableKey,
): StableKey[] => {
	const out: StableKey[] = [];
	const stack: StableKey[] = [rootKey];
	while (stack.length > 0) {
		const k = stack.pop();
		if (!k) break;
		const n = state.nodesByKey.get(k);
		if (!n) continue;
		out.push(k);
		const children = state.childrenByParentKey.get(k) ?? [];
		for (const child of children) stack.push(child);
	}
	return out;
};

export const overlayDeleteSubtree = (
	state: OverlayState,
	rootKey: StableKey,
): boolean => {
	if (!state.nodesByKey.has(rootKey)) return false;

	const subtree = overlaySubtreeKeys(state, rootKey);
	for (const k of subtree) state.nodesByKey.delete(k);

	for (const k of subtree) state.childrenByParentKey.delete(k);

	const parentKey = parentKeyOf(rootKey);
	if (parentKey) {
		const siblings = state.childrenByParentKey.get(parentKey) ?? [];
		const next = siblings.filter((c) => !subtree.includes(c));
		if (next.length > 0) state.childrenByParentKey.set(parentKey, next);
		else state.childrenByParentKey.delete(parentKey);
	}

	for (const [pk, children] of state.childrenByParentKey.entries()) {
		const next = children.filter((c) => state.nodesByKey.has(c));
		if (next.length > 0) state.childrenByParentKey.set(pk, next);
		else state.childrenByParentKey.delete(pk);
	}

	return true;
};

export const overlayHasAnyDescendant = (
	state: OverlayState,
	rootKey: StableKey,
): boolean => {
	const children = state.childrenByParentKey.get(rootKey) ?? [];
	return children.some((c) => state.nodesByKey.has(c));
};
