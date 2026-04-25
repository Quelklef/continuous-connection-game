<script lang="ts">
	import { onMount } from "svelte";
	import GameBoard from "$lib/GameBoard.svelte";
	let moves = $state([]);
	let playerMode: 1 | { socket: WebSocket } = $state(1);
	onMount(
		() =>
			(playerMode = {
				socket: new WebSocket(`ws://${location.hostname}:8090`),
			}),
	);
</script>

<GameBoard size={14} bind:moves {playerMode} />
