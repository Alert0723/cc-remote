/**
 * 全局 Toast 容器
 * 挂载在 App 根节点，监听 toast 管理器事件
 */

import { useState, useEffect, useCallback } from 'react';
import { Toast } from './Toast.js';
import { subscribeToast, getCurrentToast, dismissToast } from '../lib/toast.js';

export function ToastContainer() {
  const [data, setData] = useState(getCurrentToast());

  useEffect(() => {
    return subscribeToast(() => setData(getCurrentToast()));
  }, []);

  const handleDismiss = useCallback(() => dismissToast(), []);

  return (
    <Toast
      text={data?.text ?? ''}
      type={data?.type ?? 'success'}
      visible={data !== null}
      duration={data?.duration ?? 1500}
      onDismiss={handleDismiss}
    />
  );
}
