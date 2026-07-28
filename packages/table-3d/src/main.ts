/**
 * Entry point: mount the preview scene and wire the control panel.
 */
import {
  buildTableViews,
  CASINO_IDS,
  PREVIEW_MODE_LABELS,
  PreviewApp,
  type PreviewMode,
  type TableViewId,
} from "./scene/preview-app.js";
import { getCasinoTheme, type CasinoId } from "./specs/casino-theme.js";

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
}

main();
