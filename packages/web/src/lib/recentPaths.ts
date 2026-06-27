/**
 * 最近使用的项目路径持久化存储
 * 独立于会话列表，即使删除对话后路径历史依然保留
 */

const STORAGE_KEY = 'cc-recent-paths';
const MAX_ENTRIES = 50;

/** 读取最近使用的项目路径列表（去重，最近在前） */
export function getRecentPaths(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === 'string' && p.length > 0);
  } catch {
    return [];
  }
}

/** 添加一条项目路径到历史记录（去重，上限裁剪，最近使用在前） */
export function addRecentPath(path: string): void {
  if (!path) return;
  // 规范化路径分隔符
  const normalized = path.replace(/\\/g, '/').replace(/\/+/g, '/');
  const paths = getRecentPaths();
  // 移除旧条目（去重）
  const filtered = paths.filter((p) => p !== normalized);
  // 插入到最前面
  filtered.unshift(normalized);
  // 裁剪到上限
  if (filtered.length > MAX_ENTRIES) {
    filtered.length = MAX_ENTRIES;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch {
    // localStorage 满时静默失败
  }
}
