<script lang="ts">
	type Props = {
		playerMode: 1 | { socket: WebSocket };
		connected: boolean;
		isMultiplayerEnabled: boolean;
		setMultiplayerEnabled: (next: boolean) => void;

		copyBoardShot: () => void;
		boardShotCopyState: "idle" | "copied" | "failed";

		turnPlayer: 1 | 2;

		clockStarted: boolean;
		clockPaused: boolean;
		clockEnabled: boolean;
		clockTotalMs: number;
		clockGainMs: number;
		clockRemainingMsP1: number;
		clockRemainingMsP2: number;
		clockActivePlayer: 1 | 2;
		toggleClockEnabled: () => void;
		setClockTotalMs: (next: number) => void;
		setClockGainMs: (next: number) => void;
		toggleClockPaused: () => void;

		size: number;
		movesPlayed: number;
		minBoardSize: number;
		maxBoardSize: number;
		applyBoardSize: (next: number) => void;

		isComponentOutlinesEnabled: boolean;

		extraInfoEnabled: boolean;
		setExtraInfoEnabled: (next: boolean) => void;
		rotationEnabled: boolean;
		setRotationEnabled: (next: boolean) => void;
		bordersShown: boolean;
		setBordersShown: (next: boolean) => void;
		futureEnabled: boolean;
		setFutureEnabled: (next: boolean) => void;
		isFutureToggleDisabled: boolean;

		wsUrl: string;
		wsUrlDraft: string;
		wsUrlError: string | null;
		saveWsUrl: (() => void) | undefined;

		player1Color: string;
		player2Color: string;
		commitColors: () => void;
		resetColors: () => void;
		isResetColorsDisabled: boolean;
		resetColorsTitle: string;

		zoomX: number;
		isZoomAtOneX: boolean;
		resetView: () => void;

		isUndoDisabled: boolean;
		undo: () => void;
		newGame: () => void;

		isSwapShown: boolean;
		isSwapDisabled: boolean;
		swap: () => void;
	};

	let {
		connected,
		isMultiplayerEnabled,
		setMultiplayerEnabled,

		copyBoardShot,
		boardShotCopyState,

		turnPlayer,

		clockStarted,
		clockPaused,
		clockEnabled,
		clockTotalMs,
		clockGainMs,
		clockRemainingMsP1,
		clockRemainingMsP2,
		clockActivePlayer,
		toggleClockEnabled,
		setClockTotalMs,
		setClockGainMs,
		toggleClockPaused,

		size,
		movesPlayed,
		minBoardSize,
		maxBoardSize,
		applyBoardSize,

		isComponentOutlinesEnabled = $bindable(),

		extraInfoEnabled,
		setExtraInfoEnabled,
		rotationEnabled,
		setRotationEnabled,
		bordersShown,
		setBordersShown,
		futureEnabled,
		setFutureEnabled,
		isFutureToggleDisabled,

		wsUrl,
		wsUrlDraft = $bindable(""),
		wsUrlError,
		saveWsUrl,

		player1Color = $bindable(),
		player2Color = $bindable(),
		commitColors,
		resetColors,
		isResetColorsDisabled,
		resetColorsTitle,

		zoomX,
		isZoomAtOneX,
		resetView,

		isUndoDisabled,
		undo,
		newGame,

		isSwapShown,
		isSwapDisabled,
		swap,
	}: Props = $props();

	let isWsConfigShown = $derived(!!saveWsUrl);
	let wsStatus = $derived(
		isMultiplayerEnabled ? (connected ? "online" : "connecting") : "local",
	);
	let isWsDirty = $derived(wsUrlDraft.trim() !== wsUrl.trim());

	const clampInt = (v: number, lo: number, hi: number): number =>
		Math.max(lo, Math.min(hi, Math.round(v)));

	const formatMs = (msRaw: number): string => {
		const ms = Math.trunc(msRaw);
		const isNeg = ms < 0;
		const abs = Math.abs(ms);
		const totalSeconds = Math.floor(abs / 1000);
		const s = totalSeconds % 60;
		const m = Math.floor(totalSeconds / 60) % 60;
		const h = Math.floor(totalSeconds / 3600);
		const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
		const ss = String(s).padStart(2, "0");
		return `${isNeg ? "-" : ""}${h > 0 ? `${h}:` : ""}${mm}:${ss}`;
	};

	let totalSecondsDraft = $state("");
	let gainSecondsDraft = $state("");
	$effect(() => {
		totalSecondsDraft = String(Math.round(clockTotalMs / 1000));
		gainSecondsDraft = String(Math.round(clockGainMs / 1000));
	});

	const commitTotal = (): void => {
		if (!clockEnabled) return;
		const parsed = Number.parseInt(totalSecondsDraft.trim(), 10);
		if (Number.isNaN(parsed)) return;
		setClockTotalMs(clampInt(parsed, 0, 24 * 60 * 60) * 1000);
	};
	const commitGain = (): void => {
		if (!clockEnabled) return;
		const parsed = Number.parseInt(gainSecondsDraft.trim(), 10);
		if (Number.isNaN(parsed)) return;
		setClockGainMs(clampInt(parsed, 0, 24 * 60 * 60) * 1000);
	};

	const connectToDraftUrl = (): void => {
		saveWsUrl?.();
		if (!isMultiplayerEnabled) setMultiplayerEnabled(true);
	};

	const cancelWsEdit = (): void => {
		wsUrlDraft = wsUrl;
	};

	const onWsInputKeyDown = (e: KeyboardEvent): void => {
		if (!isWsDirty) return;
		if (e.key === "Enter") {
			e.preventDefault();
			connectToDraftUrl();
		} else if (e.key === "Escape") {
			e.preventDefault();
			cancelWsEdit();
		}
	};

	const saveWsTargetToUrl = (): void => {
		if (typeof window === "undefined") return;
		const next = wsUrlDraft.trim();

		let ok: boolean;
		let result: URL | null = null;
		try {
			result = new URL(window.location.href);
			ok = true;
		} catch {
			ok = false;
		}
		if (!ok || !result) return;

		if (!next) {
			result.searchParams.delete("relay_target");
			result.searchParams.delete("relay_secure");
		} else {
			let ok2: boolean;
			let parsed: URL | null = null;
			try {
				parsed = new URL(next);
				ok2 = true;
			} catch {
				ok2 = false;
			}
			if (!ok2 || !parsed) return;

			const isSecure = parsed.protocol === "wss:";
			const relayTarget = `${parsed.host}${parsed.pathname}${parsed.search}`;
			result.searchParams.set("relay_target", relayTarget);
			if (isSecure) result.searchParams.set("relay_secure", "true");
			else result.searchParams.delete("relay_secure");
		}

		window.history.replaceState({}, "", result.toString());
	};
</script>

{#snippet gameStateSection()}
	<div class="section">
		<div class="sectionTitle">
			<div>game state</div>
		</div>

		<div class="kv">
			<div class="muted">board size</div>
			<div class="boardSizeRight">
				<div class="boardSizeValue">{size}</div>
				<button
					class="iconBtn miniBtn"
					title="Decrease board size"
					aria-label="Decrease board size"
					disabled={size <= minBoardSize}
					onclick={() => applyBoardSize(size - 1)}
				>
					-
				</button>
				<button
					class="iconBtn miniBtn"
					title="Increase board size"
					aria-label="Increase board size"
					disabled={size >= maxBoardSize}
					onclick={() => applyBoardSize(size + 1)}
				>
					+
				</button>
			</div>
		</div>

		<div class="kv" style:margin-top="8px">
			<div class="muted">turn</div>
			<div class="turnPills" aria-label="Turn">
				<div class="turnPill" class:active={turnPlayer === 1}>p1</div>
				<div class="turnPill" class:active={turnPlayer === 2}>p2</div>
			</div>
		</div>

		<div class="kv" style:margin-top="8px">
			<div class="muted">moves played</div>
			<div>{movesPlayed}</div>
		</div>

		<div class="kv" style:margin-top="10px">
			<div class="muted">turn timer</div>
			<label class="sectionEnable">
				<input
					class="check"
					type="checkbox"
					aria-label="Enable turn timer"
					checked={clockEnabled}
					onchange={toggleClockEnabled}
				/>
				<span class="muted">enable</span>
			</label>
		</div>

		<div class="timerRow" style:margin-top="8px">
			<div class="timerGrid" aria-label="Turn timer">
				<div class="timerHalf" class:active={clockActivePlayer === 1}>
					<div class="timerPlayer muted">p1</div>
					<div class="timerValue" class:overtime={clockRemainingMsP1 < 0}>
						{formatMs(clockRemainingMsP1)}
					</div>
				</div>
				<div class="timerHalf" class:active={clockActivePlayer === 2}>
					<div class="timerPlayer muted">p2</div>
					<div class="timerValue" class:overtime={clockRemainingMsP2 < 0}>
						{formatMs(clockRemainingMsP2)}
					</div>
				</div>
			</div>
			<button
				class="iconBtn"
				disabled={!clockEnabled}
				title={clockPaused ? "Resume turn timer" : "Pause turn timer"}
				aria-label={clockPaused ? "Resume turn timer" : "Pause turn timer"}
				onclick={toggleClockPaused}
			>
				pause
			</button>
		</div>

		<div class="timerRow" style:margin-top="6px">
			<div class="timerParams">
				<label class="timerParam">
					<span class="muted">total</span>
					<input
						class="timerInput"
						inputmode="numeric"
						aria-label="Turn timer total seconds"
						bind:value={totalSecondsDraft}
						onblur={commitTotal}
						onkeydown={(e) => {
							if (e.key === "Enter") commitTotal();
						}}
					/>
				</label>
				<label class="timerParam">
					<span class="muted">gain</span>
					<input
						class="timerInput"
						inputmode="numeric"
						aria-label="Turn timer gain seconds"
						bind:value={gainSecondsDraft}
						onblur={commitGain}
						onkeydown={(e) => {
							if (e.key === "Enter") commitGain();
						}}
					/>
				</label>
			</div>
			<button
				class="iconBtn"
				disabled={!clockEnabled}
				title={clockPaused ? "Resume turn timer" : "Pause turn timer"}
				aria-label={clockPaused ? "Resume turn timer" : "Pause turn timer"}
				onclick={toggleClockPaused}
			>
				pause
			</button>
		</div>

		{#if !clockEnabled}
			<div class="timerNote muted">disabled</div>
		{:else if !clockStarted}
			<div class="timerNote muted">starts after p1’s first move</div>
		{/if}

		<div class="buttons" style:margin-top="10px">
			<button class="btn" disabled={isUndoDisabled} onclick={undo}>undo</button>
			{#if isSwapShown}
				<button class="btn" disabled={isSwapDisabled} onclick={swap}
					>swap</button
				>
			{/if}
			<button
				class="btn btnDanger"
				title="Reset to a new game"
				onclick={newGame}
			>
				new game
			</button>
		</div>
	</div>
{/snippet}

{#snippet multiplayerSection()}
	<div class="section">
		<div class="sectionTitle">
			<div>multiplayer</div>
			<label class="sectionEnable">
				<input
					class="check"
					type="checkbox"
					aria-label="Enable multiplayer"
					checked={isMultiplayerEnabled}
					onchange={(e) =>
						setMultiplayerEnabled(
							(e.currentTarget as HTMLInputElement).checked,
						)}
				/>
				<span class="muted">enable</span>
			</label>
		</div>
		<div class="wsEditor">
			<div class="wsEditorMain">
				<div class="wsEditorShell">
					<input
						class="wsInput"
						aria-label="Target URL"
						bind:value={wsUrlDraft}
						placeholder="ws://localhost:8090"
						onkeydown={onWsInputKeyDown}
						disabled={!isWsConfigShown}
					/>
				</div>
			</div>
			<button
				class="wsSaveIconBtn"
				title="Save WebSocket target to URL"
				aria-label="Save WebSocket target to URL"
				onclick={saveWsTargetToUrl}
				disabled={!isWsConfigShown}
			>
				save
			</button>
		</div>
		<div class="kv" style:margin-top="8px">
			<div class="muted">status</div>
			<div class="wsStatusText">{wsStatus}</div>
		</div>
		{#if wsUrlError}
			<div class="wsError">{wsUrlError}</div>
		{/if}
	</div>
{/snippet}

{#snippet keybindingsSection()}
	<div class="section">
		<div class="sectionTitle">
			<div>keybindings</div>
		</div>
		<div class="shortcutList">
			<div class="keycap">scroll</div>
			<div class="keyRow">
				<div>zoom</div>
				<div class="keyRowRight">
					<div class="muted">[{Math.round(zoomX * 100) / 100}×]</div>
					<button
						class="iconBtn"
						title={isZoomAtOneX ? "Already at 1×" : "Reset view"}
						aria-label="Reset view"
						disabled={isZoomAtOneX}
						onclick={resetView}
					>
						reset
					</button>
				</div>
			</div>

			<div class="keycap">right-drag</div>
			<div>pan</div>

			<div class="keycap">e</div>
			<div class="modeRow">
				<div>
					show extra info <span class="muted">*(mode)*</span>
				</div>
				<input
					class="check"
					type="checkbox"
					aria-label="Toggle extra info"
					checked={extraInfoEnabled}
					onchange={(e) =>
						setExtraInfoEnabled((e.currentTarget as HTMLInputElement).checked)}
				/>
			</div>

			<div class="keycap">r</div>
			<div class="modeRow">
				<div>
					rotate stone <span class="muted">*(mode)*</span>
				</div>
				<input
					class="check"
					type="checkbox"
					aria-label="Toggle stone rotation mode"
					checked={rotationEnabled}
					onchange={(e) =>
						setRotationEnabled((e.currentTarget as HTMLInputElement).checked)}
				/>
			</div>

			<div class="keycap"></div>
			<div class="muted">hold ctrl for finer rotation</div>

			<div class="keycap">f</div>
			<div class="modeRow">
				<div>
					preview future moves <span class="muted">*(mode)*</span>
				</div>
				<input
					class="check"
					type="checkbox"
					aria-label="Toggle future move preview"
					checked={futureEnabled}
					disabled={isFutureToggleDisabled}
					onchange={(e) =>
						setFutureEnabled((e.currentTarget as HTMLInputElement).checked)}
				/>
			</div>

			<div class="keycap">b</div>
			<div class="modeRow">
				<div>
					show component borders <span class="muted">*(mode)*</span>
				</div>
				<input
					class="check"
					type="checkbox"
					aria-label="Toggle component borders"
					checked={bordersShown}
					onchange={(e) =>
						setBordersShown((e.currentTarget as HTMLInputElement).checked)}
				/>
			</div>

			<div class="keycap"></div>
			<div class="muted">modes: hold key or use shift+key to toggle</div>
		</div>
	</div>
{/snippet}

{#snippet screenshotSection()}
	<div class="section">
		<div class="sectionTitle">
			<div>screenshot</div>
		</div>
		<div class="kv">
			<div class="muted">screenshot</div>
			<div class="shotRight">
				<button
					class="iconBtn"
					title="Copy a screenshot of the board to clipboard"
					aria-label="Copy board screenshot"
					onclick={copyBoardShot}
				>
					copy
				</button>
				{#if boardShotCopyState !== "idle"}
					<div class="shotStatus" class:ok={boardShotCopyState === "copied"}>
						{boardShotCopyState === "copied" ? "copied" : "failed"}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/snippet}

{#snippet playerColorsSection()}
	<div class="section">
		<div class="sectionTitle">
			<div>player colors</div>
		</div>

		<div class="colorRow" title={resetColorsTitle}>
			<div class="colorInline">
				<div class="colorSwatch">
					<span class="swatchDot" style:background={player1Color}></span>
					<div class="muted">p1</div>
				</div>
				<input
					class="colorInput"
					type="color"
					aria-label="player 1 color"
					bind:value={player1Color}
					onchange={commitColors}
				/>
			</div>

			<div class="colorInline">
				<div class="colorSwatch">
					<span class="swatchDot" style:background={player2Color}></span>
					<div class="muted">p2</div>
				</div>
				<input
					class="colorInput"
					type="color"
					aria-label="player 2 color"
					bind:value={player2Color}
					onchange={commitColors}
				/>
			</div>

			<button
				class="iconBtn"
				disabled={isResetColorsDisabled}
				title={resetColorsTitle}
				aria-label="Reset colors"
				onclick={resetColors}
			>
				<svg class="icon iconLarge" viewBox="0 0 24 24" aria-hidden="true">
					<path
						d="M6.2 8.5A7 7 0 1 1 5 12h2a5 5 0 1 0 1.2-3.2L10 10.6V5H5l1.2 1.2Z"
						fill="currentColor"
						opacity="0.9"
					/>
				</svg>
			</button>
		</div>
	</div>
{/snippet}

<div class="toolbar">
	<div class="sections">
		{@render gameStateSection()}
		{@render multiplayerSection()}
		{@render keybindingsSection()}
		{@render playerColorsSection()}
		{@render screenshotSection()}
	</div>
</div>

<style>
	.toolbar {
		align-self: flex-start;
		min-width: 260px;
		max-width: 320px;
		--control-h: 32px;
		font-size: 13px;
		color: rgba(0, 0, 0, 0.84);
		background: rgba(255, 255, 255, 0.72);
		backdrop-filter: blur(10px);
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 12px;
		padding: 10px;
		box-shadow: 0 14px 36px rgba(0, 0, 0, 0.12);
		box-sizing: border-box;
	}

	.sections {
		display: flex;
		flex-direction: column;
		gap: 0px;
	}

	.section {
		padding: 8px 2px;
	}

	.section + .section {
		margin-top: 10px;
	}

	.sectionTitle {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
		font-weight: 650;
		margin-bottom: 8px;
	}

	.icon {
		width: 16px;
		height: 16px;
		opacity: 0.85;
	}

	.iconLarge {
		width: 18px;
		height: 18px;
	}

	.kv {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}

	.boardSizeRight {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.boardSizeValue {
		font-weight: 650;
		letter-spacing: 0.2px;
	}

	.turnPills {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.turnPill {
		padding: 3px 8px;
		border-radius: 999px;
		border: 1px solid rgba(0, 0, 0, 0.14);
		background: rgba(255, 255, 255, 0.6);
		color: rgba(0, 0, 0, 0.62);
		font-weight: 650;
		font-size: 12px;
		line-height: 1.1;
	}

	.turnPill.active {
		border-color: rgba(0, 0, 0, 0.22);
		background: rgba(0, 0, 0, 0.08);
		color: rgba(0, 0, 0, 0.86);
	}

	.timerRow {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.keyRow {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}

	.keyRowRight {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.modeRow {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}

	.wsEditor {
		display: flex;
		align-items: flex-start;
		gap: 8px;
	}

	.wsEditorMain {
		flex: 1;
		min-width: 0;
	}

	.wsEditorShell {
		width: 100%;
		border-radius: 12px;
		border: 1px solid rgba(0, 0, 0, 0.12);
		background: rgba(255, 255, 255, 0.9);
		overflow: hidden;
	}

	.wsInput {
		width: 100%;
		height: var(--control-h);
		box-sizing: border-box;
		border-radius: 0;
		border: none;
		padding: 0.5em 1em;
		background: transparent;
		color: rgba(0, 0, 0, 0.86);
		outline: none;
	}

	.wsInput:focus {
		box-shadow: none;
	}

	.wsEditorShell:focus-within {
		border-color: rgba(0, 0, 0, 0.22);
	}

	.wsSaveIconBtn {
		align-self: flex-start;
		border: 1px solid rgba(0, 0, 0, 0.12);
		border-radius: 12px;
		background: rgba(255, 255, 255, 0.7);
		color: rgba(0, 0, 0, 0.78);
		min-width: 52px;
		height: var(--control-h);
		box-sizing: border-box;
		padding: 0 10px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition:
			transform 80ms ease,
			background 120ms ease,
			border-color 120ms ease;
	}

	.wsSaveIconBtn:hover {
		transform: translateY(-1px);
		border-color: rgba(0, 0, 0, 0.18);
		background: rgba(255, 255, 255, 0.82);
	}

	.wsSaveIconBtn:active {
		transform: translateY(0px);
	}

	.wsStatusText {
		text-transform: lowercase;
	}

	.wsError {
		margin-top: 8px;
		font-size: 12px;
		color: rgba(180, 20, 40, 0.92);
	}

	.shotRight {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.shotStatus {
		font-size: 12px;
		font-weight: 650;
		opacity: 0.85;
	}

	.shotStatus.ok {
		color: rgba(10, 120, 55, 0.95);
	}

	.check {
		width: 18px;
		height: 18px;
		accent-color: rgba(0, 0, 0, 0.7);
		cursor: pointer;
	}

	.check:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.iconBtn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--control-h);
		height: var(--control-h);
		box-sizing: border-box;
		border-radius: 9px;
		border: 1px solid rgba(0, 0, 0, 0.12);
		background: rgba(255, 255, 255, 0.9);
		color: rgba(0, 0, 0, 0.78);
		cursor: pointer;
		transition:
			transform 80ms ease,
			border-color 120ms ease;
	}

	.iconBtn:hover {
		transform: translateY(-1px);
		border-color: rgba(0, 0, 0, 0.18);
	}

	.iconBtn:active {
		transform: translateY(0px);
	}

	.iconBtn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		transform: none;
	}

	.iconBtn:disabled:hover {
		transform: none;
	}

	.miniBtn {
		width: 24px;
		height: 24px;
		border-radius: 8px;
		font-size: 14px;
		line-height: 1;
	}

	.colorRow {
		margin-top: 4px;
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.colorInline {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 4px 6px;
		border-radius: 12px;
		border: 1px solid rgba(0, 0, 0, 0.08);
		background: rgba(255, 255, 255, 0.75);
	}

	.colorInput {
		width: 24px;
		height: 16px;
		padding: 0;
		border: none;
		background: transparent;
		cursor: pointer;
	}

	.colorSwatch {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.swatchDot {
		width: 9px;
		height: 9px;
		border-radius: 999px;
		border: 1px solid rgba(0, 0, 0, 0.14);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
	}

	.buttons {
		display: grid;
		grid-template-columns: 1fr;
		gap: 6px;
	}

	.sectionEnable {
		display: inline-flex;
		align-items: center;
		gap: 0px;
		font-size: 10px;
		font-weight: 600;
		margin-left: 3px;
		user-select: none;
	}

	.sectionEnable .check {
		transform: scale(0.8);
		transform-origin: left center;
	}

	.timerGrid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
	}

	.timerHalf {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		padding: 6px 8px;
		border-radius: 12px;
		background: rgba(255, 255, 255, 0.55);
		border: 1px solid rgba(0, 0, 0, 0.06);
	}

	.timerHalf.active {
		background: rgba(255, 255, 255, 0.85);
		border-color: rgba(0, 0, 0, 0.12);
	}

	.timerPlayer {
		min-width: 18px;
	}

	.timerValue {
		font-variant-numeric: tabular-nums;
		font-weight: 750;
		letter-spacing: 0.2px;
		padding: 2px 6px;
		border-radius: 10px;
	}

	.timerValue.overtime {
		background: rgba(200, 20, 40, 0.95);
		color: white;
		font-weight: 900;
	}

	.timerNote {
		margin-top: 8px;
		font-size: 12px;
	}

	.timerParams {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
	}

	.timerParam {
		display: grid;
		gap: 3px;
	}

	.timerInput {
		width: 72px;
		height: 30px;
		padding: 0 8px;
		border-radius: 10px;
		border: 1px solid rgba(0, 0, 0, 0.12);
		background: rgba(255, 255, 255, 0.92);
		color: rgba(0, 0, 0, 0.86);
		font-weight: 650;
		font-variant-numeric: tabular-nums;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		height: var(--control-h);
		box-sizing: border-box;
		padding: 0.5em 1em;
		border-radius: 12px;
		border: 1px solid rgba(0, 0, 0, 0.12);
		background: rgba(255, 255, 255, 0.92);
		color: rgba(0, 0, 0, 0.86);
		font-weight: 600;
		cursor: pointer;
		transition:
			transform 80ms ease,
			background 120ms ease,
			border-color 120ms ease,
			opacity 120ms ease;
	}

	.btn:hover {
		transform: translateY(-1px);
		border-color: rgba(0, 0, 0, 0.18);
	}

	.btn:active {
		transform: translateY(0px);
	}

	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		transform: none;
	}

	.btnDanger {
		border-color: rgba(180, 20, 40, 0.28);
		background: rgba(255, 255, 255, 0.92);
		color: rgba(160, 20, 40, 0.92);
	}

	.btnDanger:hover {
		border-color: rgba(180, 20, 40, 0.4);
		background: rgba(255, 240, 242, 0.95);
	}

	label {
		cursor: pointer;
	}

	.shortcutList {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 6px 10px;
		align-items: baseline;
		font-size: 12px;
		line-height: 1.2;
	}

	.keycap {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 3px 8px;
		border-radius: 10px;
		border: 1px solid rgba(0, 0, 0, 0.12);
		background: rgba(255, 255, 255, 0.9);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
		font-weight: 650;
		letter-spacing: 0.2px;
	}

	.muted {
		opacity: 0.78;
	}
</style>
