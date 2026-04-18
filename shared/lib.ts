export const ensureCoverage = (_: never) => _;

export class Bad {
	info: string;

	static handle<A, B>(
		value: A | Bad,
		good: (handleValue: A) => B,
		bad: (handleBad: string) => B,
	) {
		if (value instanceof Bad) return bad(value.info);
		else return good(value);
	}

	constructor(info: string) {
		this.info = info;
	}
}
