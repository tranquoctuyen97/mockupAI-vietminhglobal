/**
 * SSE Channel — in-memory EventEmitter for real-time events
 */

import { EventEmitter } from "node:events";

export interface SSEEvent {
  type: string;
  data: unknown;
}

class SSEChannelManager {
  private emitters = new Map<string, EventEmitter>();

  getOrCreate(channelId: string): EventEmitter {
    let emitter = this.emitters.get(channelId);
    if (!emitter) {
      emitter = new EventEmitter();
      emitter.setMaxListeners(20);
      this.emitters.set(channelId, emitter);
    }
    return emitter;
  }

  emit(channelId: string, event: SSEEvent): void {
    const emitter = this.emitters.get(channelId);
    if (emitter) {
      emitter.emit("message", event);
    }
  }

  remove(channelId: string): void {
    const emitter = this.emitters.get(channelId);
    if (emitter) {
      emitter.removeAllListeners();
      this.emitters.delete(channelId);
    }
  }
}

// Singleton
export const sseChannels = new SSEChannelManager();
