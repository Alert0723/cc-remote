/**
 * 会话抽屉组件
 * 从左侧滑入的面板，展示已连接的会话 + 主机磁盘上的可用会话
 * 列表项支持右滑菜单（断开 / 删除），点击操作后二次确认
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { shortenPath as shortenPathUtil } from '../lib/path.js';
import { useSessionStore } from '../stores/sessionStore.js';
import { useConnectionStore } from '../stores/connectionStore.js';
import { showToast } from '../lib/toast.js';
import { getRecentPaths, addRecentPath } from '../lib/recentPaths.js';
import type { SessionInfo } from '@cc-remote/shared';

interface SessionDrawerProps {
  open: boolean;
  onClose: () => void;
  /** 打开后自动展开「新建会话」路径选择器 */
  autoCreate?: boolean;
}

/** 磁盘可用会话条目 */
interface AvailableSession {
  sessionId: string;
  projectPath: string;
  attached: boolean;
}

/** 状态标签映射 */
const STATUS_LABELS: Record<string, string> = {
  idle: '空闲',
  busy: '忙碌',
  waiting_approval: '待审批',
  stopped: '已停止',
};

/** 状态颜色映射 */
const STATUS_COLORS: Record<string, string> = {
  idle: 'var(--success)',
  busy: 'var(--accent)',
  waiting_approval: 'var(--warning)',
  stopped: 'var(--text-muted)',
};

/** 滑动阈值（px），超过此距离视为「打开菜单」 */
const SWIPE_THRESHOLD = 40;
/** 菜单总宽度 */
const ACTION_WIDTH = 64;

// ─── 确认对话框 ────────────────────────────────────────────

interface ConfirmDialog {
  title: string;
  message: string;
  confirmLabel: string;
  confirmStyle: React.CSSProperties;
  onConfirm: () => void;
}

// ─── 右滑菜单行 ────────────────────────────────────────────

interface SwipeAction {
  label: string;
  icon: React.ReactNode;
  bgColor: string;
  textColor: string;
  onTap: () => void; // 点击后触发二次确认
}

function SwipeableRow({
  children,
  actions,
  swipeId,
  openSwipeId,
  onOpen,
  onClose,
  showHandle = false,
}: {
  children: React.ReactNode;
  actions: SwipeAction[];
  swipeId: string;
  openSwipeId: string | null;
  onOpen: (id: string) => void;
  onClose: () => void;
  showHandle?: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startOffset = useRef(0);
  const rowRef = useRef<HTMLDivElement>(null);
  const isOpen = openSwipeId === swipeId;

  const totalActionWidth = actions.length * ACTION_WIDTH;

  // 外部关闭时回弹
  useEffect(() => {
    if (!isOpen && !dragging) {
      setOffset(0);
    }
  }, [isOpen, dragging]);

  // 外部点击任意处时关闭菜单
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: TouchEvent | MouseEvent) => {
      if (rowRef.current && !rowRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('touchstart', handler, { passive: true });
    document.addEventListener('mousedown', handler);
    return () => {
      document.removeEventListener('touchstart', handler);
      document.removeEventListener('mousedown', handler);
    };
  }, [isOpen, onClose]);

  // ── 触摸滑动（移动端）──
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      startX.current = e.touches[0]?.clientX ?? 0;
      startOffset.current = offset;
      setDragging(true);
    },
    [offset]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!dragging) return;
      const dx = e.touches[0]?.clientX - startX.current;
      const newOffset = Math.min(0, Math.max(-totalActionWidth, startOffset.current + dx));
      setOffset(newOffset);
    },
    [dragging, totalActionWidth]
  );

  const handleTouchEnd = useCallback(() => {
    setDragging(false);
    if (offset < -SWIPE_THRESHOLD) {
      setOffset(-totalActionWidth);
      onOpen(swipeId);
    } else {
      setOffset(0);
      onClose();
    }
  }, [offset, totalActionWidth, onOpen, onClose, swipeId]);

  // ── PC：点击 ⋮ 把手切换菜单 ──
  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (isOpen) {
        setOffset(0);
        onClose();
      } else {
        setOffset(-totalActionWidth);
        onOpen(swipeId);
      }
    },
    [isOpen, totalActionWidth, onOpen, onClose, swipeId]
  );

  return (
    <div
      ref={rowRef}
      style={{
        position: 'relative',
        overflow: 'hidden',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      {/* 背后的操作按钮 */}
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          display: 'flex',
          flexDirection: 'row',
        }}
      >
        {actions.map((action, i) => (
          <button
            key={i}
            onClick={(e) => {
              e.stopPropagation();
              action.onTap();
            }}
            style={{
              width: `${ACTION_WIDTH}px`,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              border: 'none',
              background: action.bgColor,
              color: action.textColor,
              fontSize: '11px',
              fontWeight: 600,
              fontFamily: "'Inter', sans-serif",
              cursor: 'pointer',
              padding: '8px 4px',
            }}
          >
            {action.icon}
            <span>{action.label}</span>
          </button>
        ))}
      </div>

      {/* 前景内容（移动端触摸滑动，PC 端点击 ⋮ 把手切换） */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          position: 'relative',
          transform: `translateX(${offset}px)`,
          transition: dragging ? 'none' : 'transform 0.2s ease',
          background: 'var(--bg-secondary)',
          zIndex: 1,
        }}
      >
        {children}
        {/* 操作把手（移动端仅视觉提示，PC 端点击展开/收起菜单） */}
        {showHandle && (
          <div
            onClick={handleToggle}
            title="点击展开操作菜单"
            style={{
              position: 'absolute',
              right: '2px',
              top: 0,
              bottom: 0,
              width: '28px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '3px',
              cursor: 'pointer',
              opacity: 0.3,
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = '0.7'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = '0.3'; }}
          >
            <div style={{ width: '3px', height: '3px', borderRadius: '50%', background: 'var(--text-muted)' }} />
            <div style={{ width: '3px', height: '3px', borderRadius: '50%', background: 'var(--text-muted)' }} />
            <div style={{ width: '3px', height: '3px', borderRadius: '50%', background: 'var(--text-muted)' }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 确认对话框（底部滑入） ──────────────────────────────────

function ConfirmSheet({
  dialog,
  onDismiss,
}: {
  dialog: ConfirmDialog;
  onDismiss: () => void;
}) {
  return (
    <>
      {/* 遮罩 */}
      <div
        onClick={onDismiss}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.3)',
          zIndex: 200,
          animation: 'fade-in 0.12s ease',
        }}
      />
      {/* 底部弹窗 */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'var(--bg-elevated)',
          borderTopLeftRadius: '16px',
          borderTopRightRadius: '16px',
          padding: '20px 18px 28px',
          zIndex: 201,
          animation: 'slide-up 0.2s ease',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.12)',
        }}
      >
        <h3
          style={{
            fontSize: '16px',
            fontWeight: 700,
            color: 'var(--text-primary)',
            fontFamily: "'Inter Tight', 'Inter', sans-serif",
            margin: '0 0 8px',
          }}
        >
          {dialog.title}
        </h3>
        <p
          style={{
            fontSize: '13px',
            color: 'var(--text-secondary)',
            fontFamily: "'Inter', sans-serif",
            margin: '0 0 20px',
            lineHeight: 1.5,
          }}
        >
          {dialog.message}
        </p>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={onDismiss}
            style={{
              flex: 1,
              padding: '12px 0',
              borderRadius: '12px',
              border: '2px solid var(--border-color)',
              background: 'transparent',
              color: 'var(--text-primary)',
              fontSize: '15px',
              fontWeight: 600,
              fontFamily: "'Inter Tight', 'Inter', sans-serif",
              cursor: 'pointer',
            }}
          >
            取消
          </button>
          <button
            onClick={() => {
              dialog.onConfirm();
              onDismiss();
            }}
            style={{
              flex: 1,
              padding: '12px 0',
              borderRadius: '12px',
              border: 'none',
              fontSize: '15px',
              fontWeight: 600,
              fontFamily: "'Inter Tight', 'Inter', sans-serif",
              cursor: 'pointer',
              ...dialog.confirmStyle,
            }}
          >
            {dialog.confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}

// ─── 图标组件 ──────────────────────────────────────────────

/** 断开连接图标 */
function UnlinkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

/** 删除图标 */
function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

// ─── 主组件 ────────────────────────────────────────────────

export function SessionDrawer({ open, onClose, autoCreate }: SessionDrawerProps) {
  const sessions = useSessionStore((s) => s.sessions);
  const currentSessionId = useSessionStore((s) => s.currentSessionId);
  const setCurrentSession = useSessionStore((s) => s.setCurrentSession);
  const attachDiskSession = useSessionStore((s) => s.attachDiskSession);
  const fetchAvailableSessions = useSessionStore((s) => s.fetchAvailableSessions);
  const detachSession = useSessionStore((s) => s.detachSession);
  const deleteDiskSession = useSessionStore((s) => s.deleteDiskSession);
  const closeSession = useSessionStore((s) => s.closeSession);
  const reconnectSession = useSessionStore((s) => s.reconnectSession);

  const [availableSessions, setAvailableSessions] = useState<AvailableSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);

  // 分区折叠状态：已连接默认展开，其余默认折叠
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    connected: false,
    disk: true,
    stopped: true,
  });
  const [confirm, setConfirm] = useState<ConfirmDialog | null>(null);

  // 抽屉关闭时清理
  useEffect(() => {
    if (!open) {
      setOpenSwipeId(null);
      setConfirm(null);
    }
  }, [open]);

  // 当前已连接会话的 ID 集合（断开后从内存移除，不再出现在此处）
  const attachedIds = new Set(sessions.map((s) => s.id));

  const validSessions = sessions.filter((s) => s.status !== 'stopped');
  const stoppedSessions = sessions.filter((s) => s.status === 'stopped');
  const idleSessions = validSessions.filter((s) => s.status === 'idle');
  const activeSessions = validSessions.filter((s) => s.status !== 'idle');

  const unattachedDisk = availableSessions.filter((a) => !attachedIds.has(a.sessionId));

  useEffect(() => {
    if (open) {
      setLoading(true);
      fetchAvailableSessions()
        .then((list) => setAvailableSessions(list))
        .finally(() => setLoading(false));
    }
  }, [open]);

  const handleSelectAttached = async (sessionId: string) => {
    setCurrentSession(sessionId);
    const { wsClient } = useConnectionStore.getState();
    if (wsClient?.isConnected()) {
      wsClient.switchSession(sessionId);
    }
    // stopped spawn 会话：点击时自动重新激活
    const session = sessions.find(s => s.id === sessionId);
    if (session?.status === 'stopped') {
      try {
        await reconnectSession(sessionId);
        showToast('已重新激活', 'success');
      } catch (err: any) {
        showToast(`激活失败: ${err?.message || '未知错误'}`, 'error', 3000);
      }
    }
    onClose();
  };

  const handleAttachDisk = async (sessionId: string, projectPath?: string) => {
    setLoading(true);
    try {
      await attachDiskSession(sessionId, projectPath);
      if (projectPath) addRecentPath(projectPath);
      showToast('已连接', 'success');
      onClose();
    } catch (err: any) {
      showToast(`连接失败: ${err?.message || '未知错误'}`, 'error', 3000);
    } finally {
      setLoading(false);
    }
  };

  const handleSwipeOpen = (id: string) => {
    setOpenSwipeId(id);
  };

  const handleSwipeClose = () => {
    setOpenSwipeId(null);
  };

  if (!open) return null;

  return (
    <>
      {/* 遮罩层 */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.35)',
          zIndex: 100,
          animation: 'fade-in 0.15s ease',
        }}
      />

      {/* 抽屉面板 */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          width: '300px',
          maxWidth: '85vw',
          background: 'var(--bg-secondary)',
          borderRight: '1px solid var(--border-color)',
          zIndex: 101,
          display: 'flex',
          flexDirection: 'column',
          animation: 'slide-in-left 0.2s ease',
          boxShadow: '4px 0 24px rgba(0, 0, 0, 0.15)',
        }}
      >
        {/* 抽屉头部 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 18px',
            borderBottom: '1px solid var(--border-color)',
            flexShrink: 0,
          }}
        >
          <h2
            style={{
              fontFamily: "'Inter Tight', 'Inter', sans-serif",
              fontSize: '16px',
              fontWeight: 700,
              color: 'var(--text-primary)',
              letterSpacing: '-0.01em',
              margin: 0,
            }}
          >
            我的对话
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              onClick={() => {
                setLoading(true);
                fetchAvailableSessions().then(() => setLoading(false)).catch(() => setLoading(false));
              }}
              title="刷新列表"
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '14px',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 8a6 6 0 0 1 10.5-4" />
                <path d="M14 8a6 6 0 0 1-10.5 4" />
                <path d="M12.5 1v3.5H9" />
                <path d="M3.5 15v-3.5H7" />
              </svg>
            </button>
            <button
              onClick={onClose}
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '14px',
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* 会话列表 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 0' }}>
          {loading ? (
            <div
              style={{
                padding: '24px 18px',
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: '13px',
              }}
            >
              加载中…
            </div>
          ) : validSessions.length === 0 && unattachedDisk.length === 0 && stoppedSessions.length === 0 ? (
            <div
              style={{
                padding: '24px 18px',
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: '13px',
              }}
            >
              暂无可用会话
            </div>
          ) : (
            <>
              {/* ── 已连接的有效会话 ── */}
              {validSessions.length > 0 && (
                <>
                  <SectionLabel
                    text="已连接"
                    count={validSessions.length}
                    collapsed={collapsed.connected}
                    onToggle={() => setCollapsed(c => ({ ...c, connected: !c.connected }))}
                  />
                  {!collapsed.connected && (
                    <>
                      {/* 活跃会话：不可操作 */}
                      {activeSessions.map((s) => (
                        <SessionItem
                          key={s.id}
                          session={s}
                          isCurrent={s.id === currentSessionId}
                          onClick={() => handleSelectAttached(s.id)}
                        />
                      ))}

                      {/* 闲置会话：右滑→断开 / 接管 */}
                      {idleSessions.map((s) => (
                        <SwipeableRow
                          key={s.id}
                          swipeId={s.id}
                          openSwipeId={openSwipeId}
                          onOpen={handleSwipeOpen}
                          onClose={handleSwipeClose}
                          showHandle
                          actions={[{
                              label: '断开',
                              icon: <UnlinkIcon />,
                              bgColor: 'var(--accent)',
                              textColor: '#fff',
                              onTap: () => {
                                handleSwipeClose();
                                setConfirm({
                              title: '断开会话连接',
                              message: `断开后该会话将移至「已停止」分区，之后可从「主机上可用」重新连接。`,
                              confirmLabel: '确定断开',
                              confirmStyle: {
                                background: 'var(--accent)',
                                color: '#fff',
                              },
                              onConfirm: async () => {
                                await detachSession(s.id);
                                setConfirm(null);
                                showToast('已断开连接', 'success');
                                // 刷新主机上可用列表，让断开的会话立即出现
                                fetchAvailableSessions()
                                  .then((list) => setAvailableSessions(list))
                                  .catch(() => {});
                              },
                            });
                          },
                        },
                      ]}
                    >
                      <SessionItem
                        session={s}
                        isCurrent={s.id === currentSessionId}
                        onClick={() => handleSelectAttached(s.id)}
                      />
                    </SwipeableRow>
                  ))}
                    </>
                  )}
                </>
              )}

              {/* ── 主机磁盘上的可用会话（右滑→删除）── */}
              {unattachedDisk.length > 0 && (
                <>
                  <SectionLabel
                    text="主机上可用"
                    count={unattachedDisk.length}
                    collapsed={collapsed.disk}
                    onToggle={() => setCollapsed(c => ({ ...c, disk: !c.disk }))}
                  />
                  {!collapsed.disk && unattachedDisk.map((a) => (
                    <SwipeableRow
                      key={a.sessionId}
                      swipeId={`disk-${a.sessionId}`}
                      openSwipeId={openSwipeId}
                      onOpen={handleSwipeOpen}
                      onClose={handleSwipeClose}
                      showHandle
                      actions={[
                        {
                          label: '删除',
                          icon: <TrashIcon />,
                          bgColor: 'var(--danger)',
                          textColor: '#fff',
                          onTap: () => {
                            handleSwipeClose();
                            setConfirm({
                              title: '删除磁盘会话',
                              message: '该会话将从列表中移除。对话记录会保留在磁盘上，不会丢失。',
                              confirmLabel: '确定删除',
                              confirmStyle: {
                                background: 'var(--danger)',
                                color: '#fff',
                              },
                              onConfirm: async () => {
                                await deleteDiskSession(a.sessionId, a.projectPath);
                                setConfirm(null);
                                showToast('已删除', 'success');
                                setLoading(true);
                                fetchAvailableSessions()
                                  .then((list) => setAvailableSessions(list))
                                  .finally(() => setLoading(false));
                              },
                            });
                          },
                        },
                      ]}
                    >
                      <DiskSessionContent
                        session={a}
                        onClick={() => handleAttachDisk(a.sessionId, a.projectPath)}
                      />
                    </SwipeableRow>
                  ))}
                </>
              )}

              {/* 已停止会话（右滑→删除） */}
              {stoppedSessions.length > 0 && (
                <>
                  <SectionLabel
                    text="已停止"
                    count={stoppedSessions.length}
                    collapsed={collapsed.stopped}
                    onToggle={() => setCollapsed(c => ({ ...c, stopped: !c.stopped }))}
                  />
                  {!collapsed.stopped && stoppedSessions.map((s) => (
                    <SwipeableRow
                      key={s.id}
                      swipeId={`stopped-${s.id}`}
                      openSwipeId={openSwipeId}
                      onOpen={handleSwipeOpen}
                      onClose={handleSwipeClose}
                      showHandle
                      actions={[{
                        label: '删除',
                        icon: <TrashIcon />,
                        bgColor: 'var(--danger)',
                        textColor: '#fff',
                        onTap: () => {
                          handleSwipeClose();
                          setConfirm({
                            title: '删除已停止会话',
                            message: '删除后可从「主机上可用」重新连接',
                            confirmLabel: '确定删除',
                            confirmStyle: { background: 'var(--danger)', color: '#fff' },
                            onConfirm: () => {
                              closeSession(s.id);
                              setConfirm(null);
                            },
                          });
                        },
                      }]}
                    >
                      <SessionItem
                        session={s}
                        isCurrent={s.id === currentSessionId}
                        onClick={() => handleSelectAttached(s.id)}
                      />
                    </SwipeableRow>
                  ))}
                </>
              )}
            </>
          )}
        </div>

        {/* 抽屉底部：快速操作 */}
        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid var(--border-color)',
            flexShrink: 0,
          }}
        >
          <CreateSessionButton autoExpand={autoCreate} />
        </div>
      </div>

      {/* 二次确认对话框 */}
      {confirm && <ConfirmSheet dialog={confirm} onDismiss={() => setConfirm(null)} />}
    </>
  );
}

// ─── 子组件 ────────────────────────────────────────────────

/** 分区标签（可折叠） */
function SectionLabel({
  text, count, collapsed, onToggle,
}: {
  text: string; count: number; collapsed?: boolean; onToggle?: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        width: '100%',
        padding: '10px 18px 4px',
        border: 'none',
        background: 'transparent',
        cursor: onToggle ? 'pointer' : 'default',
        fontSize: '11px',
        fontWeight: 600,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        fontFamily: "'Inter', sans-serif",
      }}
    >
      {onToggle && (
        <svg
          width="10" height="10" viewBox="0 0 10 10"
          fill="none" stroke="currentColor" strokeWidth="1.5"
          strokeLinecap="round"
          style={{
            transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
            transition: 'transform 0.15s',
            flexShrink: 0,
          }}
        >
          <path d="M3 2l3 3-3 3" />
        </svg>
      )}
      {text} ({count})
    </button>
  );
}

/** 已连接会话条目 */
/**
 * 缩短长路径用于列表展示：maxLen=35, minKeep=2
 */
function shortenPath(p: string): string {
  return shortenPathUtil(p, 25, 2);
}

/** 自适应缩短路径：从前面开始省略直到总字符数 ≤ maxLen，至少保留 minKeep 段 */
/* path utils now from lib/path.ts */
function _unused(a: number): number { return a; }
function shortenPathUtilUnused(p: string, maxLen: number, minKeep: number): string {
  if (!p) return p;
  p = p.replace(/\\/g, '/').replace(/\/+/g, '/');
  const segments = p.split('/').filter(s => s !== '');
  if (segments.length <= minKeep) return segments.join('/');

  let result = segments.join('/');
  for (let kept = segments.length; kept >= minKeep; kept--) {
    result = segments.slice(-kept).join('/');
    if (result.length <= maxLen) return result;
    // 超过时加 .../ 前缀再试
    const withPrefix = '.../' + segments.slice(-kept + 1).join('/');
    if (withPrefix.length <= maxLen) return withPrefix;
  }
  return '.../' + segments.slice(-minKeep).join('/');
}

/** 缩短路径：末尾保留 4 段（用于磁盘列表，空间较宽松） */
function shortenPathDisk(p: string): string {
  return shortenPathUtil(p, 30, 2);
}

/** 规范化路径显示：\ → /，无分隔符时尝试从已知路径匹配重建 */
function normPath(p?: string): string {
  if (!p) return '';
  const hasSep = /[\\/]/.test(p);
  // 文件系统路径必定有分隔符，若无则可能是 JSON 传输中反斜杠被丢失
  if (!hasSep) {
    // 尝试匹配常见盘符或目录前缀
    const knownRoots = ['Users', 'Workspace', 'projects'];
    for (const root of knownRoots) {
      const idx = p.indexOf(root);
      if (idx > 1) {
        const before = p.slice(0, idx - 1);
        const after = p.slice(idx);
        const segments = after.split(/([A-Z][a-z][a-z0-9]*)/).filter(Boolean);
        if (segments.length > 0) {
          return before + '/' + segments.join('/');
        }
      }
    }
  }
  return p.replace(/\\/g, '/');
}

function SessionItem({
  session,
  isCurrent,
  onClick,
}: {
  session: SessionInfo;
  isCurrent: boolean;
  onClick: () => void;
}) {
  const displayPath = shortenPath(session.projectPath || session.name || '未知项目');

  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        textAlign: 'left',
        padding: '12px 18px',
        background: isCurrent ? 'var(--accent-soft)' : 'transparent',
        border: 'none',
        cursor: 'pointer',
        transition: 'background 0.12s',
        borderLeft: isCurrent ? '3px solid var(--accent)' : '3px solid transparent',
      }}
    >
      <div
        title={session.projectPath || ''}
        style={{
          fontSize: '14px',
          fontWeight: 600,
          color: 'var(--text-primary)',
          fontFamily: "'Inter', sans-serif",
          marginBottom: '2px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {displayPath}
      </div>

      <div
        style={{
          fontSize: '12px',
          color: 'var(--text-muted)',
          fontFamily: "'Inter', sans-serif",
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span style={{ opacity: 0.7 }}>{session.id.slice(0, 8)}</span>
        {session.mode === 'spawn' && (
          <span style={{
            fontSize: '10px', fontWeight: 600, fontFamily: "'Inter', sans-serif",
            padding: '1px 5px', borderRadius: '4px',
            background: 'var(--success-bg)',
            color: 'var(--success)',
            border: '1px solid var(--success)',
            whiteSpace: 'nowrap',
          }}>
            ⚡全控制
          </span>
        )}
        <span
          style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: STATUS_COLORS[session.status] || 'var(--text-muted)',
            flexShrink: 0,
            animation: session.status === 'busy' ? 'status-pulse 1.5s ease-in-out infinite' : 'none',
          }}
        />
        <span>{STATUS_LABELS[session.status] || session.status}</span>
        {session.statusDetail && (
          <>
            <span style={{ opacity: 0.4 }}>·</span>
            <span style={{ opacity: 0.7, fontStyle: 'italic' }}>{session.statusDetail}</span>
          </>
        )}
        {session.model && (
          <>
            <span style={{ opacity: 0.4 }}>·</span>
            <span>{session.model}</span>
          </>
        )}
      </div>
    </button>
  );
}

/** 磁盘可用会话内容（无滑动菜单时的纯内容） */
function DiskSessionContent({
  session,
  onClick,
}: {
  session: AvailableSession;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        textAlign: 'left',
        padding: '12px 18px',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        transition: 'background 0.12s',
        borderLeft: '3px solid transparent',
      }}
    >
      <div
        style={{
          fontSize: '14px',
          fontWeight: 600,
          color: 'var(--text-primary)',
          fontFamily: "'Inter', sans-serif",
          marginBottom: '2px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {shortenPathDisk(session.projectPath || '') || '未知路径'}
      </div>

      <div
        style={{
          fontSize: '12px',
          color: 'var(--text-muted)',
          fontFamily: "'Inter', sans-serif",
          opacity: 0.6,
        }}
      >
        {session.sessionId.slice(0, 8)}
      </div>
    </button>
  );
}

/** 创建新会话按钮（独立持久化的项目路径历史） */
function CreateSessionButton({ autoExpand }: { autoExpand?: boolean }) {
  const createSession = useSessionStore((s) => s.createSession);
  const [showPicker, setShowPicker] = useState(false);
  const { wsClient } = useConnectionStore.getState();
  const isConnected = wsClient?.isConnected();

  // 自动展开路径选择器（从 + 按钮跳转时）
  useEffect(() => {
    if (autoExpand) setShowPicker(true);
  }, [autoExpand]);

  const recentPaths = showPicker ? getRecentPaths() : [];

  return (
    <div>
      {showPicker && (
        <div style={{ marginBottom: '8px', background: 'var(--bg-tertiary)', borderRadius: '10px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, fontFamily: "'Inter', sans-serif" }}>
            选择项目目录
            <button onClick={() => { setShowPicker(false); }} style={{ float: 'right', border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '14px' }}>✕</button>
          </div>
          {recentPaths.map((p) => (
            <button
              key={p}
              onClick={async () => {
                addRecentPath(p);
                try {
                  await createSession({ projectPath: p });
                  showToast('已创建', 'success');
                } catch (err: any) {
                  showToast(`创建失败: ${err?.message || '未知错误'}`, 'error', 3000);
                }
                setShowPicker(false);
              }}
              style={{
                display: 'block', width: '100%', padding: '10px 12px',
                border: 'none', borderTop: '1px solid var(--border-color)',
                background: 'transparent', color: 'var(--text-primary)',
                fontSize: '13px', fontFamily: "'Inter', sans-serif",
                cursor: 'pointer', textAlign: 'left',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {shortenPathDisk(p)}
            </button>
          ))}
          {recentPaths.length === 0 && (
            <div style={{ padding: '12px', fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center' }}>暂无历史项目</div>
          )}
        </div>
      )}
      <button
        onClick={() => setShowPicker(v => !v)}
        disabled={!isConnected}
        style={{
          width: '100%',
          padding: '10px 0',
          borderRadius: '12px',
          border: 'none',
          background: isConnected ? 'var(--accent)' : 'var(--bg-tertiary)',
          color: isConnected ? '#fff' : 'var(--text-muted)',
          fontSize: '14px',
          fontWeight: 600,
          fontFamily: "'Inter Tight', 'Inter', sans-serif",
          letterSpacing: '-0.01em',
          cursor: isConnected ? 'pointer' : 'default',
          display: 'flex',
          alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        transition: 'all 0.15s',
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M8 3v10M3 8h10" />
      </svg>
      新建会话
    </button>
    </div>
  );
}
