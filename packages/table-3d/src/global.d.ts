import type { RemoteSessionRuntimeConfig } from "./session/session-runtime-config.js";

declare global {
  var __MCT_ROOM_CONFIG__: Partial<RemoteSessionRuntimeConfig> | undefined;
}

export {};
