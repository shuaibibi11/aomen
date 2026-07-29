export interface WebSocketMessageEvent {
  readonly data: unknown;
}

export type WebSocketEventType = "open" | "message" | "close" | "error";
export type WebSocketEventListener = (event: unknown) => void;

export interface WebSocketLike {
  readonly readyState: number;
  addEventListener(type: WebSocketEventType, listener: WebSocketEventListener): void;
  removeEventListener(type: WebSocketEventType, listener: WebSocketEventListener): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface WebSocketFactory {
  create(url: string): WebSocketLike;
}

export interface TimerClock {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(identifier: unknown): void;
  now(): number;
}

export interface RandomSource {
  next(): number;
}

interface WebSocketConstructor {
  new (url: string): WebSocketLike;
}

interface RuntimeGlobals {
  readonly WebSocket?: WebSocketConstructor;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(identifier: unknown): void;
}

const runtimeGlobals = globalThis as unknown as RuntimeGlobals;

export const browserWebSocketFactory: WebSocketFactory = {
  create(url: string): WebSocketLike {
    const webSocketConstructor = runtimeGlobals.WebSocket;
    if (webSocketConstructor === undefined) {
      throw new Error("WebSocket is not available in this environment");
    }
    return new webSocketConstructor(url);
  },
};

export const systemTimerClock: TimerClock = {
  setTimeout(callback: () => void, delayMs: number): unknown {
    return runtimeGlobals.setTimeout(callback, delayMs);
  },
  clearTimeout(identifier: unknown): void {
    runtimeGlobals.clearTimeout(identifier);
  },
  now(): number {
    return Date.now();
  },
};

export const systemRandomSource: RandomSource = {
  next(): number {
    return Math.random();
  },
};
