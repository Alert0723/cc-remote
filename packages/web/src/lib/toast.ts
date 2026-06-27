/**
 * 全局 Toast 管理器
 * 任意组件调用 showToast() 即可在屏幕底部弹出 Toast，
 * Toast 渲染在 App 根节点，不受消息列表滚动影响。
 */

type ToastType = 'success' | 'error' | 'action';

export interface ToastData {
  text: string;
  type: ToastType;
  duration: number;
  /** 每次调用自增，用于触发重渲染 */
  id: number;
}

type Listener = () => void;

let current: ToastData | null = null;
const listeners = new Set<Listener>();
let nextId = 0;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  for (const fn of listeners) fn();
}

export function showToast(text: string, type: ToastType = 'success', duration = 1500) {
  if (dismissTimer) clearTimeout(dismissTimer);
  current = { text, type, duration, id: nextId++ };
  emit();
  // 定时器交给 Toast 组件管理（支持淡出动画）
}

export function dismissToast() {
  if (dismissTimer) clearTimeout(dismissTimer);
  current = null;
  dismissTimer = null;
  emit();
}

export function getCurrentToast(): ToastData | null {
  return current;
}

export function subscribeToast(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
