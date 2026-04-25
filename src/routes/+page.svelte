<script lang="ts">
	import GameBoard from "$lib/GameBoard.svelte";
	let moves = $state([]);
</script>

<GameBoard size={14} bind:moves />
