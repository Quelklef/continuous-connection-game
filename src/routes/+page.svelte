<script lang="ts">
	import GameBoard from "$lib/GameBoard.svelte";
	let moves = $state([]);
</script>

<GameBoard bind:moves />
