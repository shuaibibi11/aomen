import { describe, expect, it, vi } from "vitest";
import { createDenominationOptionGroup } from "./denomination-option-group.js";

class FakeButton {
  type = "";
  textContent = "";
  readonly attributes = new Map<string, string>();
  readonly clickListeners = new Set<() => void>();

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  addEventListener(_type: "click", listener: () => void): void {
    this.clickListeners.add(listener);
  }

  removeEventListener(_type: "click", listener: () => void): void {
    this.clickListeners.delete(listener);
  }

  click(): void {
    for (const listener of this.clickListeners) listener();
  }
}

class FakeContainer {
  children: FakeButton[] = [];

  replaceChildren(...buttons: FakeButton[]): void {
    this.children = buttons;
  }
}

describe("denomination option group", () => {
  it("replaces stale buttons and listeners when the rule chipset changes", () => {
    const container = new FakeContainer();
    const onSelect = vi.fn();
    const group = createDenominationOptionGroup(
      container as unknown as HTMLElement,
      () => new FakeButton() as unknown as HTMLButtonElement,
      onSelect,
    );

    expect(group.sync("HKD", [100, 500], 500)).toBe(true);
    const oldButtons = [...container.children];
    expect(oldButtons.map((button) => button.textContent)).toEqual([
      "HKD 100",
      "HKD 500",
    ]);
    expect(oldButtons[1]?.attributes.get("aria-pressed")).toBe("true");

    expect(group.sync("MOP", [1_000, 5_000], 1_000)).toBe(true);
    expect(container.children).toHaveLength(2);
    expect(container.children.map((button) => button.textContent)).toEqual([
      "MOP 1,000",
      "MOP 5,000",
    ]);
    expect(oldButtons.every((button) => button.clickListeners.size === 0)).toBe(true);
    container.children[1]?.click();
    expect(onSelect).toHaveBeenCalledWith(5_000);
  });

  it("keeps existing buttons for an ordinary snapshot with unchanged rules", () => {
    const container = new FakeContainer();
    const group = createDenominationOptionGroup(
      container as unknown as HTMLElement,
      () => new FakeButton() as unknown as HTMLButtonElement,
      vi.fn(),
    );
    group.sync("HKD", [100, 500], 100);
    const originalButtons = container.children;

    expect(group.sync("HKD", [100, 500], 100)).toBe(false);
    expect(container.children).toBe(originalButtons);
  });
});
