/**
 * Server application assembly.
 *
 * Wires the pieces together: one event store, one room manager, and — for a
 * no-human-dealer table — a system-dealer tick that drives rounds. Kept apart
 * from the entry point so a test can build the app without opening a port.
 */
import { asActorId, asTableId, type TableId } from "@mct/shared";
import { loadRulePack } from "@mct/rule-packs";
import { MemoryEventStore } from "./memory-event-store.js";
import { RoomManager, type Room } from "./room-manager.js";

export interface AppOptions {
  /** Relative path of the rule pack to load for the demo table. */
  readonly rulePackPath?: string;
  /** Table id for the demo room. */
  readonly tableId?: string;
  /** Shoe seed for the demo room. */
  readonly shoeSeed?: string;
  /** Credential required by clients joining the demo human actor. */
  readonly demoRoomCredential?: string;
}

export interface App {
  readonly store: MemoryEventStore;
  readonly roomManager: RoomManager;
  readonly demoTableId: TableId;
  readonly demoRoom: Room;
}

function resolveDemoRoomCredential(options: AppOptions): string {
  const configuredCredential =
    options.demoRoomCredential ?? process.env.DEMO_ROOM_CREDENTIAL;

  if (configuredCredential === undefined || configuredCredential.trim() === "") {
    throw new Error(
      "Demo room join credential must be configured through AppOptions or DEMO_ROOM_CREDENTIAL",
    );
  }

  return configuredCredential;
}

/**
 * Build the app with one demo room seated with a human plus two basic AI. The
 * demo room's dealer is the system dealer, so rounds can be driven by a tick or
 * by explicit calls without a human dealer present.
 */
export async function createApp(options: AppOptions = {}): Promise<App> {
  const demoRoomCredential = resolveDemoRoomCredential(options);
  const store = new MemoryEventStore();
  const roomManager = new RoomManager(store);

  const rulePack = await loadRulePack(
    options.rulePackPath ?? "dev/generic-macau-baccarat.v1.json",
  );

  const demoTableId = asTableId(options.tableId ?? "demo-table");
  const demoRoom = roomManager.createRoom({
    tableId: demoTableId,
    rulePack,
    humanActorId: asActorId("demo-human"),
    joinCredential: demoRoomCredential,
    seatCount: 7,
    aiCount: 2,
    shoeSeed: options.shoeSeed ?? "demo-seed",
  });

  return { store, roomManager, demoTableId, demoRoom };
}
