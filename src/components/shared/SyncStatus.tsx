import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { attemptBuffer } from '../../lib/attemptBuffer';
import { flushSyncQueue, pendingJobs } from '../../lib/syncQueue';
import { readLocal, writeLocal } from '../../lib/durableStorage';
import '../../lib/ieltsSubmission';

export function SyncStatus() {
  const { user } = useAuth();
  const [pending, setPending] = useState(0);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [storageError, setStorageError] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    const refresh = () => {
      setOffline(!navigator.onLine);
      setPending(pendingJobs(user.id).length + attemptBuffer.getPendingCount());
    };
    const sync = () => {
      refresh();
      if (navigator.onLine) void Promise.all([flushSyncQueue(user.id), attemptBuffer.flush()]).then(refresh);
    };
    const failed = () => setStorageError(true);
    refresh();
    sync();
    const timer = window.setInterval(sync, 30000);
    window.addEventListener('online', sync);
    window.addEventListener('offline', refresh);
    window.addEventListener('lumina:resume', sync);
    window.addEventListener('lumina:sync-change', refresh);
    window.addEventListener('lumina:storage-error', failed);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', refresh);
      window.removeEventListener('lumina:resume', sync);
      window.removeEventListener('lumina:sync-change', refresh);
      window.removeEventListener('lumina:storage-error', failed);
    };
  }, [user]);

  useEffect(() => {
    if (import.meta.env.VITE_NATIVE_APP !== 'true' || !user) return;
    const key = `lumina.last-route.v1.${user.id}`;
    if (location.pathname === '/') {
      const route = readLocal<string>(key);
      navigate(route?.startsWith('/app/') ? route : '/app/home', { replace: true });
    } else if (location.pathname.startsWith('/app/')) {
      writeLocal(key, location.pathname + location.search);
    }
  }, [location.pathname, location.search, navigate, user]);

  if (!user || (!storageError && !pending && !offline)) return null;
  return (
    <div role={storageError ? 'alert' : 'status'} className="sync-status">
      {storageError
        ? '本机存储失败，请勿退出，并检查存储空间。'
        : pending
          ? `${pending} 项进度已保存在本机，${offline ? '联网后同步' : '等待同步'}`
          : '网络已断开，已加载的答题内容可继续保存'}
      {!offline && !storageError && pending > 0 && (
        <button
          type="button"
          onClick={() => {
            void flushSyncQueue(user.id);
            void attemptBuffer.flush();
          }}
        >
          重试
        </button>
      )}
    </div>
  );
}
