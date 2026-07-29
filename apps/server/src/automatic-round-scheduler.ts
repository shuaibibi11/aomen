import type { TablePhase } from "@mct/shared";

export interface AutomaticRoundTiming {
  readonly bettingWindowMs: number;
  readonly cardDealIntervalMs: number;
  readonly settlementDisplayMs: number;
  readonly interRoundDelayMs: number;
}

export interface AutomaticRoundRoom {
  startAutomaticRound(): void;
  placeAutomaticPlayerBets(signal: AbortSignal): void | Promise<void>;
  closeAutomaticBetting(): void;
  dealNextAutomaticCard(): void;
  settleAutomaticRound(): void;
  getAutomaticRoundPhase(): TablePhase;
  isFaulted(): boolean;
}

export interface AutomaticRoundSchedulerOptions {
  readonly onError?: (error: unknown) => void;
}

const DEFAULT_ERROR_HANDLER = (error: unknown): void => {
  console.error("Automatic round scheduler stopped:", error);
};

function validateTiming(timing: AutomaticRoundTiming): void {
  const nonNegativeValues = [
    timing.bettingWindowMs,
    timing.settlementDisplayMs,
    timing.interRoundDelayMs,
  ];
  const hasInvalidNonNegativeValue = nonNegativeValues.some(
    (value) => !Number.isFinite(value) || value < 0,
  );
  const hasInvalidCardInterval =
    !Number.isFinite(timing.cardDealIntervalMs) || timing.cardDealIntervalMs <= 0;

  if (hasInvalidNonNegativeValue || hasInvalidCardInterval) {
    throw new Error(
      "Invalid automatic round timing: delays must be finite and non-negative, and cardDealIntervalMs must be greater than zero",
    );
  }
}

/** Drives one room through timed phases without owning any game rules. */
export class AutomaticRoundScheduler {
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private runGeneration = 0;
  private aiTaskController: AbortController | null = null;
  private readonly onError: (error: unknown) => void;

  constructor(
    private readonly room: AutomaticRoundRoom,
    private readonly timing: AutomaticRoundTiming,
    options: AutomaticRoundSchedulerOptions = {},
  ) {
    validateTiming(timing);
    this.onError = options.onError ?? DEFAULT_ERROR_HANDLER;
  }

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.runGeneration += 1;
    const generation = this.runGeneration;
    try {
      this.beginRound(generation);
    } catch (error) {
      this.fail(error, generation);
    }
  }

  stop(): void {
    this.running = false;
    this.runGeneration += 1;
    this.aiTaskController?.abort();
    this.aiTaskController = null;
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  private isActive(generation: number): boolean {
    return (
      this.running &&
      this.runGeneration === generation &&
      !this.room.isFaulted()
    );
  }

  private assertActive(generation: number): boolean {
    if (this.room.isFaulted()) {
      this.stop();
      return false;
    }
    return this.isActive(generation);
  }

  private beginRound(generation: number): void {
    if (!this.assertActive(generation)) {
      return;
    }
    this.room.startAutomaticRound();
    this.aiTaskController?.abort();
    const aiTaskController = new AbortController();
    this.aiTaskController = aiTaskController;
    this.startAiBetting(generation, aiTaskController);
    this.schedule(this.timing.bettingWindowMs, generation, () =>
      this.finishBetting(generation),
    );
  }

  private startAiBetting(
    generation: number,
    aiTaskController: AbortController,
  ): void {
    if (!this.assertActive(generation)) {
      return;
    }

    try {
      Promise.resolve(this.room.placeAutomaticPlayerBets(aiTaskController.signal)).catch(
        (error: unknown) => {
          if (
            this.aiTaskController === aiTaskController &&
            !aiTaskController.signal.aborted
          ) {
            this.fail(error, generation);
          }
        },
      );
    } catch (error) {
      if (
        this.aiTaskController === aiTaskController &&
        !aiTaskController.signal.aborted
      ) {
        this.fail(error, generation);
      }
    }
  }

  private finishBetting(generation: number): void {
    if (!this.assertActive(generation)) {
      return;
    }
    this.room.closeAutomaticBetting();
    this.aiTaskController?.abort();
    this.aiTaskController = null;
    this.scheduleNextCard(generation);
  }

  private scheduleNextCard(generation: number): void {
    this.schedule(this.timing.cardDealIntervalMs, generation, () => {
      this.room.dealNextAutomaticCard();
      if (!this.assertActive(generation)) {
        return;
      }

      const phase = this.room.getAutomaticRoundPhase();
      if (phase === "dealing") {
        this.scheduleNextCard(generation);
        return;
      }
      if (phase !== "settling") {
        throw new Error(`Automatic card deal reached unexpected phase: ${phase}`);
      }

      this.room.settleAutomaticRound();
      this.schedule(
        this.timing.settlementDisplayMs + this.timing.interRoundDelayMs,
        generation,
        () => this.beginRound(generation),
      );
    });
  }

  private schedule(
    delayMilliseconds: number,
    generation: number,
    action: () => void | Promise<void>,
  ): void {
    if (!this.assertActive(generation)) {
      return;
    }
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      if (!this.assertActive(generation)) {
        return;
      }
      Promise.resolve()
        .then(action)
        .catch((error: unknown) => this.fail(error, generation));
    }, delayMilliseconds);
  }

  private fail(error: unknown, generation: number): void {
    if (!this.isActive(generation)) {
      return;
    }
    this.stop();
    try {
      this.onError(error);
    } catch (reportingError) {
      console.error("Automatic round scheduler error handler failed:", reportingError);
    }
  }
}
