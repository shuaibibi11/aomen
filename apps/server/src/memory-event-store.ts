/**
 * In-memory event store.
 *
 * The table engine produces an append-only event log per table; this store
 * keeps those events in memory so the server can replay or inspect a table
 * without a database. It is deliberately minimal — append and read back — and
 * is the seam a real persistent store would replace later.
 */
import type { TableEvent, TableId } from "@mct/shared";

export interface EventStore {
  /** Append one event to a table's log. */
  append(event: TableEvent): void;
  /** All events for a table, in append order. */
  listByTable(tableId: TableId): readonly TableEvent[];
  /** Total events across every table. */
  count(): number;
}

export class MemoryEventStore implements EventStore {
  private readonly byTable = new Map<TableId, TableEvent[]>();
  private total = 0;

  append(event: TableEvent): void {
    let log = this.byTable.get(event.tableId);
    if (log === undefined) {
      log = [];
      this.byTable.set(event.tableId, log);
    }
    log.push(event);
    this.total += 1;
  }

  listByTable(tableId: TableId): readonly TableEvent[] {
    return [...(this.byTable.get(tableId) ?? [])];
  }

  count(): number {
    return this.total;
  }
}
