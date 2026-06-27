/**
 * 事件桥接器
 * 类型安全的发布/订阅单例，替代 window.__sessionStore 全局对象
 * 用于 connectionStore（WSClient）向 sessionStore 转发 ServerEvent
 */

import type { ServerEvent } from '@cc-remote/shared';

type EventHandler = (event: ServerEvent) => void;

class EventBridge {
  private handlers: EventHandler[] = [];

  /** 注册事件处理器，返回取消订阅函数 */
  on(handler: EventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  /** 向所有已注册的处理器广播事件 */
  emit(event: ServerEvent): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }
}

export const eventBridge = new EventBridge();
