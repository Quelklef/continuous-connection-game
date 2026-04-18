import * as http from "http";
import type { ClientMessage, ServerMessage } from "../shared/types.ts";
import { Bad, ensureCoverage } from "../shared/lib.ts";
import { WebSocketServer, WebSocket } from "ws";

const server = http.createServer();
const wss = new WebSocketServer({ server });
const connections: Record<number, WebSocket> = {};
let id = 0;

const parseWs = (data: string): ClientMessage | Bad => {
	try {
		const parsed = JSON.parse(data) as ClientMessage;
		switch (parsed.message.type) {
			case "move":
				if (
					typeof parsed.message.data[0] === "number" &&
					typeof parsed.message.data[1] === "number"
				)
					return parsed;
				else return new Bad("'move' type has incorrect data");
			case "undo":
			case "swap":
				return parsed;
			default:
				ensureCoverage(parsed.message);
				return new Bad(`not of type ClientMessage`);
		}
	} catch (e) {
		return new Bad(`JSON did not parse: ${data}`);
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

		if (numConnections() === 2) {
			const p1Index = Math.round(Math.random());
			const p2Index = 1 - p1Index;
			const connectionsList = Object.values(connections);
			send(connectionsList[p1Index], { type: "assign player", data: 1 });
			send(connectionsList[p2Index], { type: "assign player", data: 2 });
		}

		ws.on("close", () => {
			delete connections[wsId];
			logConnections();
		});

		ws.on("error", console.error);

		ws.on("message", (data) => {
			Bad.handle(
				parseWs(data.toString()),
				({ id, message }) => {
					const otherClients: WebSocket[] = Object.entries(connections)
						.filter(([cid]) => cid !== id.toString())
						.map((a) => a[1]);

					switch (message.type) {
						case "move":
							otherClients.forEach((client) => send(client, message));
							break;
						case "undo":
						case "swap":
							otherClients.forEach((client) => send(client, message));
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
