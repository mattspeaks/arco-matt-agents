import { EventEmitter } from 'node:events';

/** In-process pub/sub; the websocket route forwards everything to the browser. */
export const bus = new EventEmitter();
bus.setMaxListeners(200);

export type LiveType =
  | 'run'
  | 'run_event'
  | 'chat_message'
  | 'approval'
  | 'board'
  | 'conversation'
  | 'checklist';

export function publish(type: LiveType, payload: unknown): void {
  bus.emit('live', { type, payload });
}
