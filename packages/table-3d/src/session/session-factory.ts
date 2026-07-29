import { LocalTableSession } from "./local-table-session.js";
import type {
  TableSession,
  TableSessionFactory,
  TableSessionOptions,
} from "./table-session.js";

export const createLocalTableSession: TableSessionFactory = async (options) =>
  new LocalTableSession(options);

/** Owns session replacement and rejects stale asynchronous factory results. */
export class TableSessionController {
  private activeSession: TableSession | null = null;
  private activeVariant: TableSessionOptions["variant"] | null = null;
  private requestedVariant: TableSessionOptions["variant"] | null = null;
  private requestSequence = 0;

  constructor(private readonly factory: TableSessionFactory) {}

  get current(): TableSession | null {
    return this.activeSession;
  }

  async open(options: TableSessionOptions): Promise<TableSession | null> {
    const requestSequence = ++this.requestSequence;
    this.requestedVariant = options.variant;
    if (this.activeSession !== null && this.activeVariant === options.variant) {
      return this.activeSession;
    }

    const createdSession = await this.factory(options);
    if (
      requestSequence !== this.requestSequence ||
      this.requestedVariant !== options.variant
    ) {
      createdSession.dispose();
      return null;
    }

    this.activeSession?.dispose();
    this.activeSession = createdSession;
    this.activeVariant = options.variant;
    return createdSession;
  }

  dispose(): void {
    this.requestSequence += 1;
    this.activeSession?.dispose();
    this.activeSession = null;
    this.activeVariant = null;
    this.requestedVariant = null;
  }
}
