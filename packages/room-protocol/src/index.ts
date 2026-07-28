/**
 * Public surface of @mct/room-protocol.
 *
 * The WebSocket message contracts and the protocol version. Both the client and
 * the server import from here, so a wire-shape change is a single edit.
 */
export * from "./messages.js";
