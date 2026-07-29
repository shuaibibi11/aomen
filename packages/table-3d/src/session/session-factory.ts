import { LocalTableSession } from "./local-table-session.js";
import { RoomConnection } from "@mct/room-client";
import { asActorId, asTableId } from "@mct/shared";
import { RemoteTableSession } from "./remote-table-session.js";
import type { SessionRuntimeConfig } from "./session-runtime-config.js";
import type {
  TableSession,
  TableSessionFactory,
  TableSessionOptions,
} from "./table-session.js";

export const createLocalTableSession: TableSessionFactory = async (options) =>
  new LocalTableSession(options);

export function createConfiguredTableSessionFactory(
  runtimeConfig: SessionRuntimeConfig,
): TableSessionFactory {
  if (runtimeConfig.runtime === "local") return createLocalTableSession;
  return async () => RemoteTableSession.create({
    connection: new RoomConnection({
      url: runtimeConfig.wsUrl,
      tableId: asTableId(runtimeConfig.tableId),
      actorId: asActorId(runtimeConfig.actorId),
      credential: runtimeConfig.credential,
      connectTimeoutMs: 5_000,
      joinTimeoutMs: 5_000,
      heartbeatIntervalMs: 10_000,
      pongTimeoutMs: 5_000,
      reconnectBaseDelayMs: 500,
      reconnectMaxDelayMs: 10_000,
      reconnectJitterRatio: 0.2,
    }),
  });
}

/** Owns session replacement and rejects stale asynchronous factory results. */
export class TableSessionController {
  private activeSession: TableSession | null = null;
  private activeVariant: TableSessionOptions["variant"] | null = null;
  private pendingVariant: TableSessionOptions["variant"] | null = null;
  private pendingPromise: Promise<TableSession | null> | null = null;
  private requestedVariant: TableSessionOptions["variant"] | null = null;
  private requestSequence = 0;

  constructor(private readonly factory: TableSessionFactory) {}

  get current(): TableSession | null {
    return this.activeSession;
  }

  open(options: TableSessionOptions): Promise<TableSession | null> {
    if (this.activeSession !== null && this.activeVariant === options.variant) {
      this.requestSequence += 1;
      this.requestedVariant = options.variant;
      return Promise.resolve(this.activeSession);
    }

    if (
      this.pendingPromise !== null &&
      this.pendingVariant === options.variant
    ) {
      return this.pendingPromise;
    }

    const requestSequence = ++this.requestSequence;
    this.requestedVariant = options.variant;
    const factoryPromise = this.factory(options);
    const creationPromise = Promise.resolve(factoryPromise).then(
      (createdSession) => {
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
      },
    );
    const trackedPromise = creationPromise.finally(() => {
      if (this.pendingPromise === trackedPromise) {
        this.pendingPromise = null;
        this.pendingVariant = null;
      }
    });
    this.pendingVariant = options.variant;
    this.pendingPromise = trackedPromise;
    return trackedPromise;
  }

  dispose(): void {
    this.requestSequence += 1;
    this.activeSession?.dispose();
    this.activeSession = null;
    this.activeVariant = null;
    this.pendingVariant = null;
    this.pendingPromise = null;
    this.requestedVariant = null;
  }
}
