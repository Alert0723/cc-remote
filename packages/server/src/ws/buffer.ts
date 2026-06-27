/**
 * 环形缓冲区，用于断线恢复
 * 缓存最近 N 条事件，客户端重连后可从 lastSeq 补发
 */

import type { ServerEvent } from '@cc-remote/shared';

export class RingBuffer {
  private buffer: ServerEvent[];
  private head: number = 0;
  private _size: number = 0;

  constructor(private capacity: number = 5000) {
    this.buffer = new Array(capacity);
  }

  /**
   * 添加事件到缓冲区
   */
  push(event: ServerEvent): void {
    this.buffer[(this.head + this._size) % this.capacity] = event;
    if (this._size < this.capacity) {
      this._size++;
    } else {
      // 缓冲区满，覆盖最旧的数据
      this.head = (this.head + 1) % this.capacity;
    }
  }

  /**
   * 获取 fromSeq 之后的所有事件
   */
  getSince(fromSeq: number): ServerEvent[] {
    const result: ServerEvent[] = [];
    for (let i = 0; i < this._size; i++) {
      const event = this.buffer[(this.head + i) % this.capacity];
      if (event.seq > fromSeq) {
        result.push(event);
      }
    }
    return result;
  }

  /**
   * 获取最新序列号
   */
  getLatestSeq(): number {
    if (this._size === 0) return 0;
    const lastIdx = (this.head + this._size - 1) % this.capacity;
    return this.buffer[lastIdx]?.seq || 0;
  }

  /**
   * 检查 fromSeq 是否还在缓冲区内
   */
  isInBuffer(fromSeq: number): boolean {
    if (this._size === 0) return false;
    const oldestSeq = this.buffer[this.head]?.seq || 0;
    return fromSeq >= oldestSeq;
  }

  /**
   * 清空缓冲区
   */
  clear(): void {
    this.head = 0;
    this._size = 0;
  }

  /**
   * 当前大小
   */
  get size(): number {
    return this._size;
  }

  /**
   * 从数组恢复事件（用于热重启状态恢复）
   * 清空当前缓冲区，重新填入事件
   */
  restoreFromArray(events: ServerEvent[]): void {
    this.clear();
    for (const event of events) {
      this.push(event);
    }
  }

  /**
   * 导出最近 N 条事件（用于状态持久化快照）
   */
  exportRecent(count: number): ServerEvent[] {
    const result: ServerEvent[] = [];
    const start = Math.max(0, this._size - count);
    for (let i = start; i < this._size; i++) {
      result.push(this.buffer[(this.head + i) % this.capacity]);
    }
    return result;
  }
}
