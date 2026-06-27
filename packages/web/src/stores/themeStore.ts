/**
 * UI 偏好状态管理（主题、调试模式等）
 * 偏好持久化到 localStorage
 */

import { create } from 'zustand';
import { showToast } from '../lib/toast.js';

export type Theme = 'dark' | 'light';

interface UIState {
  theme: Theme;
  debugMode: boolean;
  toggle: () => void;
  setTheme: (t: Theme) => void;
  toggleDebug: () => void;
}

/** 主题 CSS 变量值（用于动态 <style> 标签注入，绕过 iOS Safari compositor 缓存） */
const DARK_VARS: Record<string, string> = {
  '--bg-primary': '#08090C', '--bg-secondary': '#101216', '--bg-tertiary': '#181A20',
  '--bg-elevated': '#202228', '--bg-bubble-user': '#5B6678', '--bg-bubble-assistant': '#181A20',
  '--text-primary': '#EEEEF0', '--text-secondary': '#8B8D95', '--text-muted': '#5C5E66',
  '--border-color': 'rgba(255,255,255,0.06)', '--border-visible': 'rgba(255,255,255,0.10)',
  '--accent': '#6C7BFF', '--accent-hover': '#8190FF', '--accent-soft': 'rgba(108,123,255,0.12)',
  '--danger': '#F04756', '--danger-bg': 'rgba(240,71,86,0.12)', '--success': '#34D399',
  '--success-bg': 'rgba(52,211,153,0.12)', '--warning': '#F5A623',
  '--warning-bg': 'rgba(245,166,35,0.12)', '--tool-bg': '#141519', '--code-bg': '#0D0E12',
  '--inline-code-bg': 'rgba(108,123,255,0.10)', '--inline-code-text': '#A5B4FC',
  '--scrollbar-thumb': 'rgba(255,255,255,0.10)', '--scrollbar-track': 'transparent',
};

const LIGHT_VARS: Record<string, string> = {
  '--bg-primary': '#F8F8FA', '--bg-secondary': '#FFFFFF', '--bg-tertiary': '#F0F0F3',
  '--bg-elevated': '#FFFFFF', '--bg-bubble-user': '#D4D7DE', '--bg-bubble-assistant': '#EEEEF2',
  '--text-primary': '#1A1A1F', '--text-secondary': '#6B6D75', '--text-muted': '#9B9DA5',
  '--border-color': 'rgba(0,0,0,0.06)', '--border-visible': 'rgba(0,0,0,0.10)',
  '--accent': '#5A6B85', '--accent-hover': '#4A5A72', '--accent-soft': 'rgba(90,107,133,0.10)',
  '--danger': '#E04050', '--danger-bg': 'rgba(224,64,80,0.10)', '--success': '#2DAD82',
  '--success-bg': 'rgba(45,173,130,0.10)', '--warning': '#E59819',
  '--warning-bg': 'rgba(229,152,25,0.10)', '--tool-bg': '#F8F8FA', '--code-bg': '#EEEEF2',
  '--inline-code-bg': 'rgba(91,111,239,0.08)', '--inline-code-text': '#4B5FD8',
  '--scrollbar-thumb': 'rgba(0,0,0,0.12)', '--scrollbar-track': 'transparent',
};

function loadTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored = localStorage.getItem('cc-remote-theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch { /* 回退默认 */ }
  return 'dark';
}

function loadDebugMode(): boolean {
  if (typeof window === 'undefined') return false;
  try { return localStorage.getItem('cc-remote-debug') === '1'; } catch { return false; }
}

/**
 * 通过动态 <style> 标签注入 CSS 变量，覆盖静态样式表中的主题选择器。
 * iOS Safari 对 class/data-* 属性切换不触发 compositor 重绘，
 * 但替换整个 <style> 标签会强制 WebKit 重建样式表并刷新所有绘制层。
 */
function applyTheme(t: Theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  // 同步 class 和 data-theme（供初始渲染 + 其他代码查询）
  root.classList.remove('theme-dark', 'theme-light');
  root.classList.add(t === 'dark' ? 'theme-dark' : 'theme-light');
  root.setAttribute('data-theme', t);

  // 动态注入 <style> 标签：用 JS 声明的变量值覆盖 CSS 文件中的定义
  const vars = t === 'dark' ? DARK_VARS : LIGHT_VARS;
  const cssText = `:root{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';')}}`;
  let el = document.getElementById('theme-dynamic-vars') as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = 'theme-dynamic-vars';
    document.head.appendChild(el);
  }
  el.textContent = cssText;

  // meta theme-color
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', t === 'dark' ? '#0A0B0E' : '#F8F8FA');
  }

  try { localStorage.setItem('cc-remote-theme', t); } catch { /* 静默 */ }
}

export const useThemeStore = create<UIState>((set, get) => {
  const initial = loadTheme();
  applyTheme(initial);

  const debugToast = (msg: string) => {
    if (get().debugMode) showToast(msg, 'action', 2500);
  };

  // debug 模式：启动时展示主题加载状态
  if (loadDebugMode()) {
    setTimeout(() => {
      const cs = getComputedStyle(document.documentElement);
      const bgVal = cs.getPropertyValue('--bg-primary').trim();
      showToast(`[Debug] 启动主题: ${initial} | --bg-primary=${bgVal.slice(0, 7)}`, 'action', 3000);
    }, 500);
  }

  return {
    theme: initial,
    debugMode: loadDebugMode(),

    toggle: () => {
      const prev = get().theme;
      const next = prev === 'dark' ? 'light' : 'dark';
      set({ theme: next });
      applyTheme(next);
      if (get().debugMode) {
        const cs = getComputedStyle(document.documentElement);
        const bgVal = cs.getPropertyValue('--bg-primary').trim();
        showToast(`[Debug] ${prev} → ${next} | --bg-primary=${bgVal.slice(0, 7)}`, 'action', 2500);
      }
    },

    setTheme: (t) => {
      set({ theme: t });
      applyTheme(t);
    },

    toggleDebug: () => {
      const next = !get().debugMode;
      set({ debugMode: next });
      try {
        localStorage.setItem('cc-remote-debug', next ? '1' : '0');
      } catch {
        // 静默忽略持久化失败
      }
    },
  };
});
