export interface PendingMutation {
  key: string;
  ownerRun: string;
  userId: string;
  runId: string;
  versionId: string;
  mutationId: string;
  cells: Array<{ index: number; color: number }>;
  createdAt: number;
}

let databasePromise: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('Локальное сохранение недоступно')); return; }
    const request = indexedDB.open('splint-pending-progress-v1', 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('mutations', { keyPath: 'key' });
      store.createIndex('ownerRun', 'ownerRun');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { databasePromise = undefined; reject(request.error); };
    request.onblocked = () => reject(new Error('Закройте другую старую вкладку Splint и повторите.'));
  });
  return databasePromise;
}

export function pendingKey(userId: string, runId: string) { return `${userId}:${runId}`; }

export async function listPending(userId: string, runId: string): Promise<PendingMutation[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutations', 'readonly');
    const request = tx.objectStore('mutations').index('ownerRun').getAll(pendingKey(userId, runId));
    request.onsuccess = () => resolve((request.result as PendingMutation[]).sort((a, b) => a.createdAt - b.createdAt));
    request.onerror = () => reject(request.error);
  });
}

export async function putPending(value: PendingMutation): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutations', 'readwrite');
    tx.objectStore('mutations').put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function deletePending(key: string): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutations', 'readwrite');
    tx.objectStore('mutations').delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
