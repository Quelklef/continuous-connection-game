import type { BoardColors } from "./types.ts";

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

export const isBoardColors = (x: unknown): x is BoardColors =>
	typeof x === "object" &&
	x !== null &&
	"p1" in x &&
	"p2" in x &&
	isValidHexColor((x as BoardColors).p1) &&
	isValidHexColor((x as BoardColors).p2);
