/**
 * Web 应用入口
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import './styles/global.css';

// 销毁旧版 PWA Service Worker + 清除 Cache Storage，避免缓存旧前端
// 注意：index.html 中已有内联脚本做第一层清理，此处为模块加载后的二次兜底
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    return Promise.all(registrations.map((r) => r.unregister()));
  }).then(() => {
    if ('caches' in window) {
      return caches.keys().then((names) =>
        Promise.all(names.map((n) => caches.delete(n)))
      );
    }
  }).catch(() => {});
}

// bfcache 恢复时强制刷新（防御层，index.html 内联脚本已做首次拦截）
window.addEventListener('pageshow', (e) => {
  if (e.persisted) window.location.reload();
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
