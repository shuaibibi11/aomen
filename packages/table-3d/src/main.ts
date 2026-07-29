/**
 * Entry point: mount the preview scene and wire the control panel.
 */
import * as THREE from "three";
import {
  buildTableViews,
  CASINO_IDS,
  PREVIEW_MODE_LABELS,
  PreviewApp,
  type PreviewMode,
  type TableViewId,
} from "./scene/preview-app.js";
import { getCasinoTheme, type CasinoId } from "./specs/casino-theme.js";
import {
  computePlayerBoxPosition,
  computeSeatPlacements,
  FELT_DEALER_EDGE_Z,
  FELT_INSET,
  findBetSpotAtWorldPosition,
  seatLocalToWorld,
} from "./specs/table-layout.js";

function requireElement<T extends HTMLElement>(elementId: string): T {
  const element = document.getElementById(elementId);
  if (element === null) {
    throw new Error(`Missing required element #${elementId}`);
  }
  return element as T;
}

/**
 * Build a single-choice button group and keep the pressed state in sync.
 */
function buildOptionGroup<TValue extends string>(
  container: HTMLElement,
  options: ReadonlyArray<{ value: TValue; label: string }>,
  initialValue: TValue,
  onSelect: (value: TValue) => void,
): void {
  const buttons = new Map<TValue, HTMLButtonElement>();

  const applySelection = (selectedValue: TValue): void => {
    for (const [value, button] of buttons) {
      button.setAttribute("aria-pressed", String(value === selectedValue));
    }
  };

  for (const option of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = option.label;
    button.setAttribute("aria-pressed", String(option.value === initialValue));
    button.addEventListener("click", () => {
      applySelection(option.value);
      onSelect(option.value);
    });
    buttons.set(option.value, button);
    container.append(button);
  }
}

function main(): void {
  const canvas = requireElement<HTMLCanvasElement>("viewport");
  const previewApp = new PreviewApp(canvas);

  const modeOptions = (Object.keys(PREVIEW_MODE_LABELS) as PreviewMode[]).map(
    (mode) => ({ value: mode, label: PREVIEW_MODE_LABELS[mode] }),
  );
  buildOptionGroup(
    requireElement("mode-options"),
    modeOptions,
    "chip-set",
    (mode) => previewApp.setMode(mode),
  );

  const casinoOptions = CASINO_IDS.map((casinoId) => ({
    value: casinoId,
    label: getCasinoTheme(casinoId).displayName.replace("（仿真訓練主題）", ""),
  }));
  buildOptionGroup(
    requireElement("casino-options"),
    casinoOptions,
    "sands-venetian" satisfies CasinoId,
    (casinoId) => previewApp.setCasino(casinoId),
  );

  // Table camera views. Labels come from the view definitions so the UI and
  // the scene cannot drift apart.
  const tableViewOptions = buildTableViews("mass").map((view) => ({
    value: view.id,
    label: view.label,
  }));
  buildOptionGroup(
    requireElement("table-view-options"),
    tableViewOptions,
    "guest" satisfies TableViewId,
    (viewId) => previewApp.setTableView(viewId),
  );

  const turntableToggle = requireElement<HTMLInputElement>("turntable-toggle");
  turntableToggle.addEventListener("change", () => {
    previewApp.setTurntable(turntableToggle.checked);
  });

  wireBettingPanel(previewApp);

  // Dev-only: Vite replaces import.meta.env.DEV with a literal, so a production
  // build drops this branch and the hook never reaches a trainee's browser.
  if (import.meta.env.DEV) {
    exposeVerificationHook(previewApp);
  }
}

/**
 * Wire the betting controls to the live session.
 *
 * The panel is only meaningful on a table, so it stays hidden until a table mode
 * is active. Every readout comes from the engine snapshot rather than from any
 * state kept here: if the engine rejected a bet, the panel shows the old numbers
 * because nothing changed, which is the behaviour we want.
 */
function wireBettingPanel(previewApp: PreviewApp): void {
  const panel = requireElement("betting-panel");
  const denominationContainer = requireElement("denomination-options");
  const actionContainer = requireElement("round-actions");
  const feedback = requireElement("bet-feedback");
  const stateReadout = requireElement("table-state-readout");
  const actionButtons: HTMLButtonElement[] = [];

  const refreshPanel = (): void => {
    const session = previewApp.getBetSession();
    panel.hidden = session === null;
    if (session === null) {
      return;
    }

    const commandPending = previewApp.isTableCommandPending();
    for (const actionButton of actionButtons) {
      actionButton.disabled = commandPending;
    }

    const snapshot = session.getSnapshot();
    const guestSeat = session.getGuestSeat();
    const rows: Array<[string, string]> = [
      ["局號", snapshot.roundId],
      ["階段", describePhase(snapshot.phase)],
      ["本座", `${guestSeat.label} 號`],
      ["可用碼", formatChips(session.getStack(guestSeat.label))],
      ["檯面注數", String(snapshot.bets.length)],
      [
        "閒／莊",
        `${snapshot.hands.playerTotal} : ${snapshot.hands.bankerTotal}`,
      ],
      ["結果", snapshot.outcome === null ? "—" : describeOutcome(snapshot.outcome)],
    ];
    stateReadout.innerHTML = rows
      .map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`)
      .join("");
  };

  // Denominations come from the rule pack's chipset, so the buttons cannot
  // offer a chip the table does not deal in.
  const initialSession = previewApp.getBetSession();
  const denominations = initialSession?.getRulePack().chipset.denominations ?? [];
  const currency = initialSession?.getRulePack().chipset.currency ?? "";
  buildOptionGroup(
    denominationContainer,
    denominations.map((value: number) => ({
      value: String(value),
      label: `${currency} ${value.toLocaleString("en-US")}`,
    })),
    String(previewApp.getSelectedDenomination() ?? denominations[0] ?? ""),
    (value) => previewApp.setSelectedDenomination(Number(value)),
  );

  const actions: ReadonlyArray<{ label: string; run: () => Promise<void> }> = [
    { label: "停止下注並發牌", run: () => previewApp.playRoundToSettlement() },
    { label: "開下一局", run: () => previewApp.startNextRound() },
    { label: "清除本座注", run: () => previewApp.clearGuestSeatBets() },
  ];
  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.addEventListener("click", async () => {
      try {
        await action.run();
      } catch (error) {
        feedback.textContent = error instanceof Error
          ? error.message
          : "動作失敗";
      }
    });
    actionButtons.push(button);
    actionContainer.append(button);
  }

  previewApp.setBetAttemptHandler((attempt) => {
    const spotName = describeBetKind(attempt.hit.spotId);
    if (attempt.accepted) {
      feedback.textContent =
        `已下注：${attempt.hit.seatLabel} 號 ${spotName} ${formatChips(attempt.amount)}`;
      return;
    }
    feedback.textContent =
      `拒絕：${attempt.hit.seatLabel} 號 ${spotName} — ${describeRejectReason(attempt.rejectReason)}`;
  });
  previewApp.setTableStateHandler(refreshPanel);

  refreshPanel();
}

function formatChips(amount: number): string {
  return amount.toLocaleString("en-US");
}

function describePhase(phase: string): string {
  const phaseLabels: Record<string, string> = {
    shoe_ready: "候局",
    round_betting: "下注中",
    no_more_bets: "停止下注",
    dealing: "發牌中",
    settling: "待結算",
    round_end: "本局結束",
  };
  return phaseLabels[phase] ?? phase;
}

function describeOutcome(outcome: string): string {
  const outcomeLabels: Record<string, string> = {
    player: "閒贏",
    banker: "莊贏",
    tie: "和局",
  };
  return outcomeLabels[outcome] ?? outcome;
}

function describeBetKind(betKind: string): string {
  const betLabels: Record<string, string> = {
    player: "閒",
    banker: "莊",
    tie: "和",
    player_pair: "閒對",
    banker_pair: "莊對",
  };
  return betLabels[betKind] ?? betKind;
}

/**
 * Translate the engine's own rejection reasons for display.
 *
 * The reasons are the engine's, not invented here: showing the real reason is
 * what makes a rejected bet a teaching moment rather than a silent failure.
 */
function describeRejectReason(reason: string | null): string {
  if (reason === null) {
    return "未知原因";
  }
  const reasonLabels: Record<string, string> = {
    wrong_phase: "現在不可下注",
    not_authorised: "無此座位權限",
    no_such_seat: "座位不存在",
    bet_below_minimum: "低於最低限紅",
    bet_above_maximum: "高於最高限紅",
    insufficient_funds: "可用碼不足",
  };
  return reasonLabels[reason] ?? reason;
}

/**
 * Expose the live scene and layout maths for the felt-mapping verifier.
 *
 * The unit tests can only check that the layout module agrees with itself. The
 * step from a world position to a texture pixel runs through geometry UVs and
 * Three.js texture sampling, so it can only be checked against a real renderer.
 * `tools/verify-felt-mapping.mjs` raycasts through this hook to confirm printed
 * ink actually lands where the layout says it should.
 */
function exposeVerificationHook(previewApp: PreviewApp): void {
  // Getters rather than snapshots: the session and the camera are replaced when
  // the table is rebuilt, and a captured reference would leave the verifier
  // testing a table that is no longer on screen.
  const debugHandle = {
    THREE,
    scene: previewApp.sceneGraph,
    get camera(): THREE.Camera {
      return previewApp.activeCamera;
    },
    get canvas(): HTMLCanvasElement {
      return previewApp.renderCanvas;
    },
    get session(): ReturnType<PreviewApp["getBetSession"]> {
      return previewApp.getBetSession();
    },
    get betSpots(): unknown {
      return previewApp.getBetSession()?.getBetSpots() ?? [];
    },
    get tableVariant(): string | null {
      return previewApp.getTableVariant();
    },
    layout: {
      FELT_INSET,
      FELT_DEALER_EDGE_Z,
      computeSeatPlacements,
      computePlayerBoxPosition,
      seatLocalToWorld,
      findBetSpotAtWorldPosition,
    },
  };
  (window as unknown as { __tableDebug: typeof debugHandle }).__tableDebug =
    debugHandle;
}

main();
