export type StableKey = string;

export type KeyMove =
	| { kind: "stone"; stone: { coords: [number, number]; theta: number } }
	| { kind: "swap" };

export const rootKey: StableKey = "r";

export const appendKey = (parentKey: StableKey, move: KeyMove): StableKey => {
	switch (move.kind) {
		case "stone": {
			const [x, y] = move.stone.coords;
			const t = move.stone.theta;
			const seg = `s${x},${y},${t}`;
			return `${parentKey}|${seg}`;
		}
		case "swap":
			return `${parentKey}|w`;
	}
};

export const parentKeyOf = (key: StableKey): StableKey | null => {
	if (key === rootKey) return null;
	const i = key.lastIndexOf("|");
	if (i < 0) return null;
	return key.slice(0, i) as StableKey;
};

export const keyDepth = (key: StableKey): number => {
	if (key === rootKey) return 0;
	let depth = 0;
	for (let i = 0; i < key.length; i += 1) {
		if (key[i] === "|") depth += 1;
	}
	return depth;
};
