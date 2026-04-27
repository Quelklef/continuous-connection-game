export type MoveData = [number, number];
export type Player = 1 | 2;
export type BoardColors = { p1: string; p2: string };
export type StableKey = string;
export type SharedPreviewMove =
	| { kind: "stone"; coords: MoveData }
	| { kind: "swap" };
export type SharedPreviewOp =
	| { kind: "presence"; active: boolean }
	| { kind: "add"; parentKey: StableKey; move: SharedPreviewMove }
	| { kind: "delete"; rootKey: StableKey };
export type ServerMessage =
	| { type: "move"; data: MoveData }
	| { type: "set size"; data: number }
	| { type: "set colors"; data: BoardColors }
	| { type: "full" }
	| { type: "assign id"; data: number }
	| { type: "assign player"; data: Player }
	| { type: "undo" }
	| { type: "swap" }
	| { type: "shared preview"; data: { senderId: number; op: SharedPreviewOp } };
export type InnerClientMessage =
	| { type: "move"; data: MoveData }
	| { type: "set size"; data: number }
	| { type: "set colors"; data: BoardColors }
	| { type: "undo" }
	| { type: "swap" }
	| { type: "shared preview"; data: SharedPreviewOp };
export type ClientMessage = {
	id: number;
	message: InnerClientMessage;
};
