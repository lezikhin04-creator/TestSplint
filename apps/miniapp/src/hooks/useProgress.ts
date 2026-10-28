import { useCallback, useEffect, useRef, useState } from 'react';
import type { PixelGrid, RunState } from '@splint/shared';
import { api, ApiError, errorMessage } from '../lib/api';
import { telegramUi } from '../lib/telegram';
import { deletePending, listPending, pendingKey, putPending } from '../lib/pending';
import type { PendingMutation } from '../lib/pending';

export function useProgress(userId: string, initialRun: RunState, grid: PixelGrid) {
  const [run, setRun] = useState(initialRun);
  const runRef = useRef(initialRun);
  const records = useRef(new Map<string, PendingMutation>());
  const [pendingIndices, setPendingIndices] = useState(new Set<number>());
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState(false);
  const blockedRef = useRef(false);
  const [localStorageError, setLocalStorageError] = useState(false);
  const persistence = useRef(Promise.resolve());
  const savingPromise = useRef<Promise<boolean> | null>(null);
  const mounted = useRef(true);

  const refreshPending = useCallback(() => {
    if (mounted.current) setPendingIndices(new Set([...records.current.values()].flatMap(record => record.cells.map(cell => cell.index))));
  }, []);
  const acceptRun = useCallback((next: RunState) => {
    if (next.id === runRef.current.id && next.revision >= runRef.current.revision) {
      runRef.current = next;
      if (mounted.current) setRun(next);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void listPending(userId, initialRun.id).then(async existing => {
      if (cancelled) return;
      const confirmed = new Set(runRef.current.filled);
      for (const record of existing) {
        if (record.versionId !== initialRun.versionId) continue;
        if (record.cells.every(cell => confirmed.has(cell.index))) {
          await deletePending(record.key).catch(() => undefined);
        } else records.current.set(record.mutationId, record);
      }
      if (!cancelled) { refreshPending(); setReady(true); }
    }).catch(() => { if (!cancelled) { setLocalStorageError(true); setReady(true); } });
    return () => { cancelled = true; mounted.current = false; };
  }, [userId, initialRun.id, initialRun.versionId, refreshPending]);

  const flush = useCallback((): Promise<boolean> => {
    if (savingPromise.current) return savingPromise.current;
    if (blockedRef.current) return Promise.resolve(false);
    const work = async () => {
      await persistence.current;
      if (!records.current.size) return true;
      if (!navigator.onLine) { if (mounted.current) setOnline(false); return false; }
      if (mounted.current) { setSaving(true); setError(''); }
      try {
        for (const record of [...records.current.values()]) {
          if (record.cells.every(cell => runRef.current.filled.includes(cell.index))) {
            await deletePending(record.key).catch(() => undefined);
            records.current.delete(record.mutationId);
            continue;
          }
          const controller = new AbortController();
          const timeout = window.setTimeout(() => controller.abort(), 20_000);
          try {
            const result = await api<{ run: RunState }>(`/runs/${encodeURIComponent(record.runId)}/progress`, {
              method: 'PATCH', body: { mutationId: record.mutationId, cells: record.cells },
              key: record.mutationId, signal: controller.signal,
            });
            acceptRun(result.run);
          } finally { window.clearTimeout(timeout); }
          // Acknowledged mutations alone are removed. Every record has a stable key/body.
          await deletePending(record.key).catch(() => { if (mounted.current) setLocalStorageError(true); });
          records.current.delete(record.mutationId);
          refreshPending();
        }
        if (mounted.current) setOnline(true);
        return records.current.size === 0;
      } catch (cause) {
        if (cause instanceof ApiError && (['ACCESS_REVOKED', 'RUN_NOT_ACTIVE', 'RUN_REPLACED', 'AUTH_REQUIRED', 'UNAUTHENTICATED', 'SESSION_EXPIRED', 'CONTENT_RESTRICTED', 'NOT_FOUND', 'ACCOUNT_DISABLED', 'MUTATION_CONFLICT', 'CONSENT_REQUIRED'].includes(cause.code) || cause.status === 401 || cause.status === 403)) {
          blockedRef.current = true;
          if (mounted.current) setBlocked(true);
        }
        if (mounted.current) setError(cause instanceof ApiError && cause.status === 401
          ? 'Сессия закончилась. Правки сохранены на этом устройстве. Закройте Mini App и откройте его из Telegram заново.'
          : cause instanceof DOMException && cause.name === 'AbortError'
          ? 'Сервер пока не ответил. Правки остаются на этом устройстве — попробуйте сохранить снова.'
          : errorMessage(cause));
        return false;
      } finally {
        savingPromise.current = null;
        if (mounted.current) setSaving(false);
        refreshPending();
      }
    };
    const promise = work();
    savingPromise.current = promise;
    // Also clear the early-return branch, which does not enter try/finally.
    void promise.finally(() => { if (savingPromise.current === promise) savingPromise.current = null; });
    return promise;
  }, [acceptRun, refreshPending]);

  const paint = useCallback((cells: Array<{ index: number; color: number }>) => {
    if (!ready || blockedRef.current || runRef.current.status !== 'active') return;
    const known = new Set(runRef.current.filled);
    for (const record of records.current.values()) for (const cell of record.cells) known.add(cell.index);
    const valid = cells.filter(cell => {
      if (!Number.isInteger(cell.index) || !grid.mask[cell.index] || grid.cells[cell.index] !== cell.color || known.has(cell.index)) return false;
      known.add(cell.index);
      return true;
    });
    if (!valid.length) return;
    for (let offset = 0; offset < valid.length; offset += 256) {
      const mutationId = crypto.randomUUID();
      const ownerRun = pendingKey(userId, initialRun.id);
      const record: PendingMutation = {
        key: `${ownerRun}:${mutationId}`, ownerRun, userId,
        runId: initialRun.id, versionId: initialRun.versionId,
        mutationId, cells: valid.slice(offset, offset + 256), createdAt: Date.now(),
      };
      records.current.set(mutationId, record);
      persistence.current = persistence.current.then(() => putPending(record)).catch(() => {
        if (mounted.current) setLocalStorageError(true);
      });
    }
    refreshPending();
    if (known.size >= runRef.current.total || records.current.size >= 16) void flush();
  }, [ready, grid, userId, initialRun.id, initialRun.versionId, refreshPending, flush]);

  useEffect(() => {
    if (!ready) return;
    const interval = window.setInterval(() => { void flush(); }, 5_000);
    const onOnline = () => { setOnline(true); void flush(); };
    const onOffline = () => setOnline(false);
    const onHidden = () => { if (document.hidden) void flush(); };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (records.current.size) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onHidden);
    void flush();
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [ready, flush]);

  useEffect(() => {
    const telegram = telegramUi('6.2');
    if (pendingIndices.size) telegram?.enableClosingConfirmation?.();
    else telegram?.disableClosingConfirmation?.();
    return () => telegram?.disableClosingConfirmation?.();
  }, [pendingIndices.size]);

  return { run, pendingIndices, ready, online, saving, error, blocked, localStorageError, paint, flush };
}
