export interface DenominationOptionGroup {
  sync(
    currency: string,
    denominations: readonly number[],
    selectedDenomination: number,
  ): boolean;
  dispose(): void;
}

interface RenderedButton {
  readonly button: HTMLButtonElement;
  readonly listener: () => void;
}

export function createDenominationOptionGroup(
  container: HTMLElement,
  createButton: () => HTMLButtonElement,
  onSelect: (denomination: number) => void,
): DenominationOptionGroup {
  let renderedSignature: string | null = null;
  let renderedButtons: RenderedButton[] = [];

  const removeRenderedListeners = (): void => {
    for (const renderedButton of renderedButtons) {
      renderedButton.button.removeEventListener("click", renderedButton.listener);
    }
    renderedButtons = [];
  };

  return {
    sync(currency, denominations, selectedDenomination) {
      const nextSignature = JSON.stringify({
        currency,
        denominations,
        selectedDenomination,
      });
      if (nextSignature === renderedSignature) {
        return false;
      }

      removeRenderedListeners();
      const buttons = denominations.map((denomination) => {
        const button = createButton();
        button.type = "button";
        button.textContent = `${currency} ${denomination.toLocaleString("en-US")}`;
        button.setAttribute(
          "aria-pressed",
          String(denomination === selectedDenomination),
        );
        const listener = (): void => {
          for (const renderedButton of renderedButtons) {
            renderedButton.button.setAttribute(
              "aria-pressed",
              String(renderedButton.button === button),
            );
          }
          onSelect(denomination);
        };
        button.addEventListener("click", listener);
        return { button, listener };
      });
      renderedButtons = buttons;
      container.replaceChildren(...buttons.map(({ button }) => button));
      renderedSignature = nextSignature;
      return true;
    },
    dispose() {
      removeRenderedListeners();
      container.replaceChildren();
      renderedSignature = null;
    },
  };
}
