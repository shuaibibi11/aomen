import type { RemoteSessionRuntimeConfig } from "./session/session-runtime-config.js";

declare global {
  var __MCT_ROOM_CONFIG__: RemoteSessionRuntimeConfig | undefined;
}

export {};
