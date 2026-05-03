<script lang="ts">
	type Props = {
		playerMode: 1 | { socket: WebSocket };
		connected: boolean;
		isMultiplayerEnabled: boolean;
		setMultiplayerEnabled: (next: boolean) => void;

		copyBoardShot: () => void;
		boardShotCopyState: "idle" | "copied" | "failed";

		turnText: string;
		turnColor: string;

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

		turnText,
		turnColor,

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

	let isSizeEditing = $state(false);
	let sizeDraft = $state("");
	let sizeInput: HTMLInputElement | null = $state(null);

	const beginEditSize = (): void => {
		isSizeEditing = true;
		sizeDraft = String(size);
	};

	const cancelEditSize = (): void => {
		isSizeEditing = false;
		sizeDraft = "";
	};

	const commitEditSize = (): void => {
		const parsed = Number.parseInt(sizeDraft.trim(), 10);
		if (Number.isNaN(parsed)) {
			cancelEditSize();
			return;
		}
		applyBoardSize(parsed);
		cancelEditSize();
	};

	$effect(() => {
		if (!isSizeEditing) return;
		queueMicrotask(() => {
			if (!sizeInput) return;
			sizeInput.focus();
			sizeInput.select();
		});
	});

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

<div class="toolbar">
	<div class="sections">
		<div class="section">
			<div class="kv">
				<div class="muted">zoom</div>
				<div class="zoomValue">
					<div>{Math.round(zoomX * 100) / 100}×</div>
					<button
						class="iconBtn"
						title={isZoomAtOneX ? "Already at 1×" : "Reset view"}
						aria-label="Reset view"
						disabled={isZoomAtOneX}
						onclick={resetView}
					>
						<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
							<path
								d="M6.2 8.5A7 7 0 1 1 5 12h2a5 5 0 1 0 1.2-3.2L10 10.6V5H5l1.2 1.2Z"
								fill="currentColor"
								opacity="0.9"
							/>
						</svg>
					</button>
				</div>
			</div>
			<div class="kv" style:margin-top="8px">
				<div class="muted">moves played</div>
				<div>{movesPlayed}</div>
			</div>
			<div class="kv" style:margin-top="8px">
				<div class="muted">turn</div>
				<div class="turnInline" style:color={turnColor}>
					{turnText}
				</div>
			</div>
			<label class="kv kvLabel" style:margin-top="8px">
				<span class="muted">component borders</span>
				<input
					class="check"
					type="checkbox"
					aria-label="Toggle connected component borders"
					bind:checked={isComponentOutlinesEnabled}
				/>
			</label>
			<div class="kv" style:margin-top="8px">
				<div class="muted">screenshot</div>
				<div class="shotRight">
					<button
						class="iconBtn"
						title="Copy a screenshot of the board to clipboard"
						aria-label="Copy board screenshot"
						onclick={copyBoardShot}
					>
						<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
							<path
								d="M9 4.5h6l1.2 1.6H19A2.5 2.5 0 0 1 21.5 8.6v8.8A2.5 2.5 0 0 1 19 19.9H5A2.5 2.5 0 0 1 2.5 17.4V8.6A2.5 2.5 0 0 1 5 6.1h2.8L9 4.5Zm3 3.2a4.1 4.1 0 1 0 0 8.2a4.1 4.1 0 0 0 0-8.2Zm0 2a2.1 2.1 0 1 1 0 4.2a2.1 2.1 0 0 1 0-4.2Z"
								fill="currentColor"
								opacity="0.9"
							/>
						</svg>
					</button>
					{#if boardShotCopyState !== "idle"}
						<div class="shotStatus" class:ok={boardShotCopyState === "copied"}>
							{boardShotCopyState === "copied" ? "copied" : "failed"}
						</div>
					{/if}
				</div>
			</div>
		</div>

		<div class="section">
			<div class="sectionTitle">
				<div>turn timer</div>
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
			<div class="timerTop">
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
					<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
						{#if clockPaused}
							<path
								d="M9 7.2v9.6L17.4 12 9 7.2Z"
								fill="currentColor"
								opacity="0.9"
							/>
						{:else}
							<path
								d="M7.5 6.5h3v11h-3v-11Zm6 0h3v11h-3v-11Z"
								fill="currentColor"
								opacity="0.9"
							/>
						{/if}
					</svg>
				</button>
			</div>
			<div class="timerGrid" aria-label="Turn timer">
				<div class="timerRow" class:active={clockActivePlayer === 1}>
					<div class="muted">p1</div>
					<div class="timerValue" class:overtime={clockRemainingMsP1 < 0}>
						{formatMs(clockRemainingMsP1)}
					</div>
				</div>
				<div class="timerRow" class:active={clockActivePlayer === 2}>
					<div class="muted">p2</div>
					<div class="timerValue" class:overtime={clockRemainingMsP2 < 0}>
						{formatMs(clockRemainingMsP2)}
					</div>
				</div>
			</div>
			{#if !clockEnabled}
				<div class="timerNote muted">disabled</div>
			{:else if !clockStarted}
				<div class="timerNote muted">starts after p1’s first move</div>
			{/if}
		</div>

		<div class="section">
			<div class="sectionTitle">
				<div>board size</div>
			</div>
			<div class="stepper" aria-label="Board size">
				<button
					class="stepBtn"
					title="Decrease board size"
					aria-label="Decrease board size"
					disabled={size <= minBoardSize}
					onclick={() => applyBoardSize(size - 1)}
				>
					<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
						<path
							d="M6.5 12.9h11v-1.8h-11v1.8Z"
							fill="currentColor"
							opacity="0.9"
						/>
					</svg>
				</button>
				<button
					type="button"
					class="stepValue"
					aria-label="Current board size"
					title="Click to edit"
					onclick={beginEditSize}
				>
					{#if isSizeEditing}
						<input
							bind:this={sizeInput}
							class="stepValueInput"
							type="text"
							inputmode="numeric"
							autocomplete="off"
							aria-label="Board size in stones"
							bind:value={sizeDraft}
							onblur={commitEditSize}
							onkeydown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									commitEditSize();
								} else if (e.key === "Escape") {
									e.preventDefault();
									cancelEditSize();
								}
							}}
						/>
					{:else}
						<div class="stepValueNumber">{size}</div>
					{/if}
					<div class="stepValueLabel">stones</div>
				</button>
				<button
					class="stepBtn"
					title="Increase board size"
					aria-label="Increase board size"
					disabled={size >= maxBoardSize}
					onclick={() => applyBoardSize(size + 1)}
				>
					<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
						<path
							d="M11.1 6.5v4.6H6.5v1.8h4.6v4.6h1.8v-4.6h4.6v-1.8h-4.6V6.5h-1.8Z"
							fill="currentColor"
							opacity="0.9"
						/>
					</svg>
				</button>
			</div>
		</div>

		<div class="section">
			<div class="sectionTitle">
				<div>colors</div>
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

		<div class="section">
			<div class="sectionTitle">
				<div>actions</div>
			</div>
			<div class="buttons">
				<button class="btn" disabled={isUndoDisabled} onclick={undo}>
					<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
						<path
							d="M9 7H5v4l1.6-1.6A7 7 0 1 1 5 12h2a5 5 0 1 0 1.5-3.5L9 7Z"
							fill="currentColor"
							opacity="0.9"
						/>
					</svg>
					undo
				</button>
				{#if isSwapShown}
					<button class="btn" disabled={isSwapDisabled} onclick={swap}>
						<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
							<path
								d="M7 7h10l-2-2 1.4-1.4L21 8l-4.6 4.4L15 11l2-2H7V7Zm10 10H7l2 2-1.4 1.4L3 16l4.6-4.4L9 13l-2 2h10v2Z"
								fill="currentColor"
								opacity="0.9"
							/>
						</svg>
						switch
					</button>
				{/if}
				<button
					class="btn btnDanger"
					title="Reset to a new game"
					onclick={newGame}
				>
					<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
						<path
							d="M7 6h10l-1 14H8L7 6Zm2-2h6l1 2H8l1-2Z"
							fill="currentColor"
							opacity="0.9"
						/>
					</svg>
					new game
				</button>
			</div>
		</div>

		{#if isWsConfigShown}
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
				<div class="wsStatus" aria-label="Multiplayer connection status">
					<div class="muted">status</div>
					<div class="wsStatusRight">
						<div class="wsStatusText">{wsStatus}</div>
						<span
							class="wsDot"
							class:online={wsStatus === "online"}
							class:connecting={wsStatus === "connecting"}
						></span>
					</div>
				</div>
				<div class="wsEditor" style:margin-top="8px">
					<div class="wsEditorMain">
						<div class="wsEditorShell">
							<input
								class="wsInput"
								aria-label="WebSocket URL"
								bind:value={wsUrlDraft}
								placeholder="ws://localhost:8090"
								onkeydown={onWsInputKeyDown}
							/>
							{#if isWsDirty}
								<div class="wsEditorButtons">
									<button
										class="wsAttachBtn wsAttachLeft"
										disabled={!wsUrlDraft.trim()}
										onclick={connectToDraftUrl}
									>
										connect
									</button>
									<button
										class="wsAttachBtn wsAttachRight"
										onclick={cancelWsEdit}
									>
										cancel
									</button>
								</div>
							{/if}
						</div>
					</div>
					<button
						class="wsSaveIconBtn"
						title="Save WebSocket target to URL"
						aria-label="Save WebSocket target to URL"
						onclick={saveWsTargetToUrl}
					>
						<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
							<path
								d="M6 4.5h10.6L20.5 8.4V19A1.5 1.5 0 0 1 19 20.5H6A1.5 1.5 0 0 1 4.5 19V6A1.5 1.5 0 0 1 6 4.5Zm0 2V19h13V9.2l-2.8-2.7H6Zm2 1.5h6v4H8v-4Zm0 8h8v3H8v-3Z"
								fill="currentColor"
								opacity="0.9"
							/>
						</svg>
					</button>
				</div>
				{#if wsUrlError}
					<div class="wsError">{wsUrlError}</div>
				{/if}
			</div>
		{/if}

		<div class="section">
			<div class="sectionTitle">
				<div>keybindings</div>
			</div>
			<div class="shortcutList">
				<div class="keycap">shift</div>
				<div>display extra board info</div>
				<div class="keycap">scroll wheel</div>
				<div>zoom</div>
				<div class="keycap">right-drag</div>
				<div>pan</div>
				{#if isMultiplayerEnabled}
					<div class="keycap">ctrl</div>
					<div>preview history</div>
					<div class="keycap">ctrl+alt</div>
					<div>shared preview (send/receive)</div>
				{/if}
			</div>
		</div>
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
		width: var(--control-h);
		height: var(--control-h);
		box-sizing: border-box;
		padding: 0;
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

	.wsEditorButtons {
		border-top: 1px solid rgba(0, 0, 0, 0.1);
		display: grid;
		grid-template-columns: 1fr 1fr;
	}

	.wsAttachBtn {
		height: var(--control-h);
		box-sizing: border-box;
		border: none;
		background: transparent;
		color: rgba(0, 0, 0, 0.86);
		font-weight: 650;
		padding: 0.5em 1em;
		cursor: pointer;
		transition:
			background 120ms ease,
			opacity 120ms ease;
	}

	.wsAttachBtn:hover {
		background: rgba(0, 0, 0, 0.04);
	}

	.wsAttachBtn:active {
		background: rgba(0, 0, 0, 0.06);
	}

	.wsAttachBtn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.wsAttachLeft {
		border-right: 1px solid rgba(0, 0, 0, 0.08);
	}

	.wsAttachRight {
		color: rgba(0, 0, 0, 0.75);
	}

	.wsStatus {
		margin-top: 8px;
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 8px;
		align-items: center;
	}

	.wsStatusRight {
		display: inline-flex;
		align-items: center;
		justify-content: flex-end;
		gap: 6px;
		min-width: 0;
	}

	.wsDot {
		width: 9px;
		height: 9px;
		border-radius: 999px;
		background: rgba(0, 0, 0, 0.22);
		border: 1px solid rgba(0, 0, 0, 0.12);
	}

	.wsDot.online {
		background: rgba(40, 150, 80, 0.95);
		border-color: rgba(20, 90, 50, 0.35);
	}

	.wsDot.connecting {
		background: rgba(215, 145, 45, 0.95);
		border-color: rgba(145, 90, 20, 0.35);
	}

	.wsStatusText {
		text-transform: lowercase;
	}

	.wsError {
		margin-top: 8px;
		font-size: 12px;
		color: rgba(180, 20, 40, 0.92);
	}

	.zoomValue {
		display: inline-flex;
		align-items: center;
		gap: 8px;
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

	.stepper {
		display: grid;
		grid-template-columns: 32px 1fr 32px;
		gap: 8px;
		align-items: center;
	}

	.stepBtn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--control-h);
		height: var(--control-h);
		box-sizing: border-box;
		border-radius: 11px;
		border: 1px solid rgba(0, 0, 0, 0.12);
		background: rgba(255, 255, 255, 0.92);
		color: rgba(0, 0, 0, 0.84);
		cursor: pointer;
		transition:
			transform 80ms ease,
			border-color 120ms ease,
			opacity 120ms ease;
	}

	.stepBtn:hover {
		transform: translateY(-1px);
		border-color: rgba(0, 0, 0, 0.18);
	}

	.stepBtn:active {
		transform: translateY(0px);
	}

	.stepBtn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
		transform: none;
	}

	.stepValue {
		height: var(--control-h);
		box-sizing: border-box;
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: 8px;
		padding: 6px 8px;
		border-radius: 12px;
		border: 1px solid rgba(0, 0, 0, 0.08);
		background: rgba(255, 255, 255, 0.75);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
		cursor: pointer;
		user-select: none;
	}

	.stepValue:hover {
		border-color: rgba(0, 0, 0, 0.14);
	}

	.stepValueInput {
		width: 5ch;
		height: calc(var(--control-h) - 8px);
		box-sizing: border-box;
		padding: 0.2em 0.5em;
		border-radius: 10px;
		border: 1px solid rgba(0, 0, 0, 0.16);
		background: rgba(255, 255, 255, 0.9);
		color: rgba(0, 0, 0, 0.86);
		outline: none;
		text-align: center;
		font: inherit;
		font-weight: 750;
	}

	.stepValueInput:focus {
		border-color: rgba(0, 0, 0, 0.22);
	}

	.stepValueNumber {
		font-size: 16px;
		font-weight: 750;
		letter-spacing: 0.2px;
	}

	.stepValueLabel {
		font-size: 12px;
		opacity: 0.7;
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

	.turnInline {
		font-weight: 750;
		letter-spacing: 0.2px;
	}

	.timerTop {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 8px;
	}

	.sectionEnable {
		display: inline-flex;
		align-items: center;
		gap: 8px;
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
		gap: 6px;
	}

	.timerRow {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 6px 8px;
		border-radius: 12px;
		background: rgba(255, 255, 255, 0.55);
		border: 1px solid rgba(0, 0, 0, 0.06);
	}

	.timerRow.active {
		background: rgba(255, 255, 255, 0.85);
		border-color: rgba(0, 0, 0, 0.12);
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

	.kvLabel {
		cursor: pointer;
		user-select: none;
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
