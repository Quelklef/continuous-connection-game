export type MoveData = [number, number];
export type StoneData = { coords: MoveData; theta: number };
export type Player = 1 | 2;
export type BoardColors = { p1: string; p2: string };
export type StableKey = string;
export type ClockSettings = {
	enabled: boolean;
	totalMs: number;
	gainMs: number;
};
export type ClockState = {
	started: boolean;
	paused: boolean;
	settings: ClockSettings;
	remainingMsP1: number;
	remainingMsP2: number;
	lastAtMs: number | null;
};
export type ClockOp =
	| { kind: "pause"; paused: boolean }
	| { kind: "settings"; settings: ClockSettings };
export type TimedMoveData = { stone: StoneData; atMs: number };
export type TimedNullary = { atMs: number };
export type SharedPreviewMove =
	| { kind: "stone"; stone: StoneData }
	| { kind: "swap" };
export type SharedPreviewOp =
	| { kind: "presence"; active: boolean }
	| { kind: "add"; parentKey: StableKey; move: SharedPreviewMove }
	| { kind: "delete"; rootKey: StableKey };
export type ServerMessage =
	| { type: "move"; data: { senderId: number; move: TimedMoveData } }
	| { type: "set size"; data: number }
	| { type: "set colors"; data: BoardColors }
	| { type: "full" }
	| { type: "assign id"; data: number }
	| { type: "assign player"; data: Player }
	| { type: "undo"; data: { senderId: number; atMs: number } }
	| { type: "swap"; data: { senderId: number; atMs: number } }
	| { type: "clock"; data: { senderId: number; atMs: number; op: ClockOp } }
	| { type: "shared preview"; data: { senderId: number; op: SharedPreviewOp } };
export type InnerClientMessage =
	| { type: "move"; data: StoneData }
	| { type: "set size"; data: number }
	| { type: "set colors"; data: BoardColors }
	| { type: "undo" }
	| { type: "swap" }
	| { type: "clock"; data: ClockOp }
	| { type: "shared preview"; data: SharedPreviewOp };
export type ClientMessage = {
	id: number;
	message: InnerClientMessage;
};
