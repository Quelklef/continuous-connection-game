import * as http from "http";
import type {
	BoardColors,
	ClientMessage,
	ServerMessage,
	SharedPreviewOp,
} from "../shared/types.ts";
import { Bad, ensureCoverage } from "../shared/lib.ts";
import {
	isBoardColors,
	isFiniteNumber,
	isMoveData,
	isValidBoardSize,
} from "../shared/validate.ts";
import { WebSocketServer, WebSocket } from "ws";

const server = http.createServer();
const wss = new WebSocketServer({ server });
const connections: Record<number, WebSocket> = {};
let id = 0;
let boardSize: number | null = null;
let boardColors: BoardColors | null = null;

const isStableKey = (u: unknown): u is string =>
	typeof u === "string" && u.trim().length > 0;

const isSharedPreviewOp = (u: unknown): u is SharedPreviewOp => {
	if (typeof u !== "object" || u === null) return false;
	if (!("kind" in u)) return false;
	const typed = u as { kind: unknown; [k: string]: unknown };
	if (typeof typed.kind !== "string") return false;

	const isSharedPreviewMove = (m: unknown): boolean => {
		if (typeof m !== "object" || m === null) return false;
		if (!("kind" in m)) return false;
		const mk = (m as { kind: unknown }).kind;
		if (mk === "swap") return true;
		if (mk === "stone")
			return "coords" in m && isMoveData((m as { coords: unknown }).coords);
		return false;
	};

	switch (typed.kind) {
		case "presence":
			return typeof typed["active"] === "boolean";
		case "add":
			return (
				isStableKey(typed["parentKey"]) &&
				"move" in typed &&
				isSharedPreviewMove(typed["move"])
			);
		case "delete":
			return isStableKey(typed["rootKey"]);
		default:
			return false;
	}
};

const parseWs = (data: string): ClientMessage | Bad => {
	let ok: boolean;
	let parsed: unknown;
	let err: unknown;
	try {
		parsed = JSON.parse(data);
		ok = true;
	} catch (e) {
		err = e;
		ok = false;
	}

	if (!ok) return new Bad(`JSON did not parse: ${String(err)}`);
	if (typeof parsed !== "object" || parsed === null)
		return new Bad("ClientMessage must be an object");

	if (!("id" in parsed) || !("message" in parsed))
		return new Bad("ClientMessage missing id/message");

	const id = (parsed as ClientMessage).id;
	const message = (parsed as ClientMessage).message;

	if (!isFiniteNumber(id) || !Number.isInteger(id) || id < 0)
		return new Bad("ClientMessage.id must be a non-negative integer");
	if (typeof message !== "object" || message === null || !("type" in message))
		return new Bad("ClientMessage.message must be an object with a type");

	const typedMessage = message as ClientMessage["message"];

	switch (typedMessage.type) {
		case "move":
			if (isMoveData(typedMessage.data)) return parsed as ClientMessage;
			else return new Bad("'move' type has incorrect data");
		case "set size":
			if (isValidBoardSize(typedMessage.data)) return parsed as ClientMessage;
			else return new Bad("'set size' type has incorrect data");
		case "set colors":
			if (isBoardColors(typedMessage.data)) return parsed as ClientMessage;
			else return new Bad("'set colors' type has incorrect data");
		case "undo":
		case "swap":
			return parsed as ClientMessage;
		case "shared preview":
			if (isSharedPreviewOp(typedMessage.data)) return parsed as ClientMessage;
			else return new Bad("'shared preview' type has incorrect data");
		default:
			ensureCoverage(typedMessage.type);
			return new Bad("ClientMessage.message.type is invalid");
	}
};

const send = (ws: WebSocket, msg: ServerMessage): void =>
	ws.send(JSON.stringify(msg));

const numConnections = (): number => Object.keys(connections).length;

const logConnections = () => console.log(Object.keys(connections));

wss.on("connection", (ws) => {
	if (numConnections() >= 2) {
		ws.send(JSON.stringify({ type: "full" }));
	} else {
		const wsId = id++;
		connections[wsId] = ws;
		send(ws, { type: "assign id", data: wsId });
		if (boardSize !== null) send(ws, { type: "set size", data: boardSize });
		if (boardColors !== null)
			send(ws, { type: "set colors", data: boardColors });

		if (numConnections() === 2) {
			const p1Index = Math.round(Math.random());
			const p2Index = 1 - p1Index;
			const connectionsList = Object.values(connections);
			send(connectionsList[p1Index], { type: "assign player", data: 1 });
			send(connectionsList[p2Index], { type: "assign player", data: 2 });
		}

		ws.on("close", () => {
			const otherClients: WebSocket[] = Object.entries(connections)
				.filter(([cid]) => cid !== wsId.toString())
				.map((a) => a[1]);
			otherClients.forEach((client) =>
				send(client, {
					type: "shared preview",
					data: { senderId: wsId, op: { kind: "presence", active: false } },
				}),
			);

			delete connections[wsId];
			if (numConnections() === 0) {
				boardSize = null;
				boardColors = null;
			}
			logConnections();
		});

		ws.on("error", console.error);

		ws.on("message", (data) => {
			Bad.handle(
				parseWs(data.toString()),
				({ id: claimedId, message }) => {
					if (claimedId !== wsId) {
						console.error(
							`client id mismatch: claimed ${claimedId}, expected ${wsId}`,
						);
						return;
					}

					const otherClients: WebSocket[] = Object.entries(connections)
						.filter(([cid]) => cid !== wsId.toString())
						.map((a) => a[1]);

					switch (message.type) {
						case "move":
							otherClients.forEach((client) => send(client, message));
							break;
						case "set size":
							boardSize = message.data;
							otherClients.forEach((client) => send(client, message));
							break;
						case "set colors":
							boardColors = message.data;
							otherClients.forEach((client) => send(client, message));
							break;
						case "undo":
						case "swap":
							otherClients.forEach((client) => send(client, message));
							break;
						case "shared preview":
							otherClients.forEach((client) =>
								send(client, {
									type: "shared preview",
									data: { senderId: wsId, op: message.data },
								}),
							);
							break;
						default:
							ensureCoverage(message);
					}
				},
				console.error,
			);
		});
	}

	logConnections();
});

server.listen(8090);
console.log("server started");
