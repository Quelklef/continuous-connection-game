export type MoveData = [number, number];
export type Player = 1 | 2;
export type ServerMessage =
	| { type: "move"; data: MoveData }
	| { type: "full" }
	| { type: "assign id"; data: number }
	| { type: "assign player"; data: Player }
	| { type: "undo" };
export type InnerClientMessage =
	| { type: "move"; data: MoveData }
	| { type: "undo" };
export type ClientMessage = {
	id: number;
	message: InnerClientMessage;
};
