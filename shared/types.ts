export type MoveData = [number, number];
export type Player = 1 | 2;
export type BoardColors = { p1: string; p2: string };
export type ServerMessage =
	| { type: "move"; data: MoveData }
	| { type: "set size"; data: number }
	| { type: "set colors"; data: BoardColors }
	| { type: "full" }
	| { type: "assign id"; data: number }
	| { type: "assign player"; data: Player }
	| { type: "undo" }
	| { type: "swap" };
export type InnerClientMessage =
	| { type: "move"; data: MoveData }
	| { type: "set size"; data: number }
	| { type: "set colors"; data: BoardColors }
	| { type: "undo" }
	| { type: "swap" };
export type ClientMessage = {
	id: number;
	message: InnerClientMessage;
};
