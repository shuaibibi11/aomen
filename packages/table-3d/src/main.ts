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

  exposeVerificationHook(previewApp);
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
  const debugHandle: TableDebugHandle = {
    THREE,
    scene: previewApp.sceneGraph,
    layout: {
      FELT_INSET,
      FELT_DEALER_EDGE_Z,
      computeSeatPlacements,
      computePlayerBoxPosition,
    },
  };
  (window as unknown as { __tableDebug: TableDebugHandle }).__tableDebug =
    debugHandle;
}

interface TableDebugHandle {
  readonly THREE: typeof THREE;
  readonly scene: THREE.Scene;
  readonly layout: {
    readonly FELT_INSET: typeof FELT_INSET;
    readonly FELT_DEALER_EDGE_Z: number;
    readonly computeSeatPlacements: typeof computeSeatPlacements;
    readonly computePlayerBoxPosition: typeof computePlayerBoxPosition;
  };
}

main();
