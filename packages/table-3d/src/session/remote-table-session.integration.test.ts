import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  MemoryEventStore,
  RoomManager,
  ServerTransport,
} from "@mct/server/testing";
import { RoomConnection, type WebSocketFactory, type WebSocketLike } from "@mct/room-client";
import { asActorId, asTableId, SYSTEM_DEALER } from "@mct/shared";
import type { RulePack } from "@mct/rule-packs";
import { RemoteTableSession } from "./remote-table-session.js";

const actorId = asActorId("integration-human");
const tableId = asTableId("integration-table");
const credential = "integration-credential";
const rulePack: RulePack = {
  id: "integration-pack",
  version: "1.0.0",
  displayName: "Integration pack",
  variant: "standard",
  limits: { min: 100, max: 10_000 },
  commission: { rate: 0.05 },
  mainPayouts: { player: 1, banker: 1, tie: 8 },
  sideBets: [],
  shoe: { deckCount: 8 },
  dealing: { peekAllowed: false },
  chipset: { currency: "HKD", denominations: [100] },
};

const openTransports: ServerTransport[] = [];

afterEach(async () => {
  await Promise.all(openTransports.splice(0).map((transport) => transport.close()));
});

describe("RemoteTableSession integration", () => {
  it("places a bet through the real connection and authoritative room", async () => {
    const roomManager = new RoomManager(new MemoryEventStore());
    const room = roomManager.createRoom({
      tableId,
      rulePack,
      humanActorId: actorId,
      joinCredential: credential,
      seatCount: 2,
      aiCount: 0,
      shoeSeed: "remote-integration-seed",
    });
    room.submitIntent({ type: "start_round", actorId: SYSTEM_DEALER });
    const transport = new ServerTransport({
      port: 0,
      host: "127.0.0.1",
      roomManager,
      allowedOrigin: undefined,
      maximumPayloadBytes: 65_536,
      isReady: () => true,
      onError: () => undefined,
    });
    openTransports.push(transport);
    await transport.waitUntilListening();
    const websocketFactory: WebSocketFactory = {
      create(url) {
        return new WebSocket(url) as unknown as WebSocketLike;
      },
    };
    const connection = new RoomConnection({
      url: `ws://127.0.0.1:${transport.getPort()}/ws`,
      tableId,
      actorId,
      credential,
      connectTimeoutMs: 2_000,
      joinTimeoutMs: 2_000,
      heartbeatIntervalMs: 10_000,
      pongTimeoutMs: 2_000,
      reconnectBaseDelayMs: 100,
      reconnectMaxDelayMs: 1_000,
      reconnectJitterRatio: 0,
      websocketFactory,
    });
    const session = await RemoteTableSession.create({ connection });

    const event = await session.placeBet(session.getGuestSeat().label, "player", 100);

    expect(event.accepted).toBe(true);
    await expect.poll(() => session.getBetAmount(session.getGuestSeat().label, "player"))
      .toBe(100);
    expect(room.getSnapshot().bets).toContainEqual({
      seatId: room.getHumanSeatId(),
      betKind: "player",
      amount: 100,
    });
    session.dispose();
  });
});
