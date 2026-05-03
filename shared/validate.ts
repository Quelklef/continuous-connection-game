import type {
	BoardColors,
	ClockOp,
	ClockSettings,
	ClockState,
	StoneData,
} from "./types.ts";

export const MIN_BOARD_SIZE = 4;
export const MAX_BOARD_SIZE = 64;

export const isValidBoardSize = (n: unknown): n is number =>
	typeof n === "number" &&
	Number.isInteger(n) &&
	n >= MIN_BOARD_SIZE &&
	n <= MAX_BOARD_SIZE;

export const isValidHexColor = (s: unknown): s is string =>
	typeof s === "string" && /^#[0-9a-fA-F]{6}$/.test(s);

export const isFiniteNumber = (n: unknown): n is number =>
	typeof n === "number" && Number.isFinite(n);

export const isMoveData = (x: unknown): x is [number, number] =>
	Array.isArray(x) &&
	x.length === 2 &&
	isFiniteNumber(x[0]) &&
	isFiniteNumber(x[1]);

export const isStoneData = (x: unknown): x is StoneData =>
	typeof x === "object" &&
	x !== null &&
	"coords" in x &&
	"theta" in x &&
	isMoveData((x as { coords: unknown }).coords) &&
	isFiniteNumber((x as { theta: unknown }).theta);

export const isClockSettings = (x: unknown): x is ClockSettings =>
	typeof x === "object" &&
	x !== null &&
	"enabled" in x &&
	"totalMs" in x &&
	"gainMs" in x &&
	typeof (x as ClockSettings).enabled === "boolean" &&
	isFiniteNumber((x as ClockSettings).totalMs) &&
	isFiniteNumber((x as ClockSettings).gainMs) &&
	(x as ClockSettings).totalMs >= 0 &&
	(x as ClockSettings).gainMs >= 0;

export const isTimedMoveData = (
	x: unknown,
): x is { stone: StoneData; atMs: number } =>
	typeof x === "object" &&
	x !== null &&
	"stone" in x &&
	"atMs" in x &&
	isStoneData((x as { stone: unknown }).stone) &&
	isFiniteNumber((x as { atMs: unknown }).atMs);

export const isTimedNullary = (x: unknown): x is { atMs: number } =>
	typeof x === "object" &&
	x !== null &&
	"atMs" in x &&
	isFiniteNumber((x as { atMs: unknown }).atMs);

export const isClockState = (x: unknown): x is ClockState =>
	typeof x === "object" &&
	x !== null &&
	"started" in x &&
	"paused" in x &&
	"settings" in x &&
	"remainingMsP1" in x &&
	"remainingMsP2" in x &&
	"lastAtMs" in x &&
	typeof (x as { started: unknown }).started === "boolean" &&
	typeof (x as { paused: unknown }).paused === "boolean" &&
	isClockSettings((x as { settings: unknown }).settings) &&
	isFiniteNumber((x as { remainingMsP1: unknown }).remainingMsP1) &&
	isFiniteNumber((x as { remainingMsP2: unknown }).remainingMsP2) &&
	((x as { lastAtMs: unknown }).lastAtMs === null ||
		isFiniteNumber((x as { lastAtMs: unknown }).lastAtMs));

export const isClockOp = (x: unknown): x is ClockOp => {
	if (typeof x !== "object" || x === null) return false;
	if (!("kind" in x)) return false;
	const kind = (x as { kind: unknown }).kind;
	if (kind === "pause")
		return typeof (x as { paused?: unknown }).paused === "boolean";
	if (kind === "settings")
		return isClockSettings((x as { settings?: unknown }).settings);
	return false;
};

export const isStampedOp = (
	x: unknown,
): x is { senderId: number; atMs: number } =>
	typeof x === "object" &&
	x !== null &&
	"senderId" in x &&
	"atMs" in x &&
	isFiniteNumber((x as { senderId: unknown }).senderId) &&
	Number.isInteger((x as { senderId: unknown }).senderId) &&
	(x as { senderId: number }).senderId >= 0 &&
	isFiniteNumber((x as { atMs: unknown }).atMs);

export const isBoardColors = (x: unknown): x is BoardColors =>
	typeof x === "object" &&
	x !== null &&
	"p1" in x &&
	"p2" in x &&
	isValidHexColor((x as BoardColors).p1) &&
	isValidHexColor((x as BoardColors).p2);
