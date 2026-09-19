import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Connection } from '../domain/types';
import { ApiError, GitHubClient } from '../adapters/github/client';
import { createHttpCache } from '../storage/http-cache';
import { CredentialProvider } from '../security/credentials';
import { savedSessionStore, type SavedSession } from '../security/saved-session';
import { db } from '../storage/db';
import { SyncEngine } from '../sync/engine';
import { acquireScopeLock } from '../sync/lock';

interface Session {
  connection: Connection | null;
  connected: boolean;
  restoring: boolean;
  remembered: boolean;
  notice: string;
  writable: boolean;
  lockState: string;
  client: GitHubClient | null;
  engine: SyncEngine | null;
  connect(repository: string, token: string, remember?: boolean): Promise<void>;
  openOffline(connection: Connection): Promise<void>;
  disconnect(): Promise<void>;
  leave(): Promise<void>;
  takeLock(): Promise<void>;
}
const Context = createContext<Session>(null!);
export function SessionProvider({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [client, setClient] = useState<GitHubClient | null>(null);
  const [engine, setEngine] = useState<SyncEngine | null>(null);
  const [lockState, setLockState] = useState('busy');
  const [restoring, setRestoring] = useState(true);
  const [remembered, setRemembered] = useState(false);
  const [notice, setNotice] = useState('');
  const runtime = useRef({
    credentials: new CredentialProvider(),
    generation: 0,
    engine: null as SyncEngine | null,
    release: () => {},
    lockScope: null as string | null,
    saved: null as SavedSession | null,
    resuming: false,
    retryAt: 0,
  });
  function stop() {
    runtime.current.generation++;
    runtime.current.engine?.stop();
    runtime.current.engine = null;
    runtime.current.credentials.clear();
    runtime.current.saved = null;
    runtime.current.resuming = false;
    runtime.current.retryAt = 0;
    setRestoring(false);
    setNotice('');
    setClient(null);
    setEngine(null);
  }
  async function lock(next: Connection) {
    if (runtime.current.lockScope === next.scopeId) return true;
    runtime.current.release();
    runtime.current.lockScope = null;
    const generation = runtime.current.generation;
    const held = await acquireScopeLock(next.scopeId);
    if (generation !== runtime.current.generation) {
      held.release();
      return false;
    }
    runtime.current.release = held.release;
    runtime.current.lockScope = held.state === 'acquired' ? next.scopeId : null;
    setLockState(held.state);
    return held.state === 'acquired';
  }
  async function connect(repository: string, token: string, remember = false) {
    const previous = runtime.current.generation;
    await flushAllDrafts();
    if (previous !== runtime.current.generation) return;
    stop();
    const generation = runtime.current.generation;
    await forget();
    if (generation !== runtime.current.generation) return;
    await establish(repository, token, generation, remember);
  }
  async function establish(
    repository: string,
    token: string,
    generation: number,
    remember = false,
    saved?: SavedSession,
  ) {
    runtime.current.credentials.set(token);
    const adapter = new GitHubClient(runtime.current.credentials, {
      cache: createHttpCache(),
    });
    try {
      const next = await adapter.connect(repository);
      if (generation !== runtime.current.generation) return;
      // A reused repository name must never attach another identity to the old notebook's queue.
      if (saved && next.scopeId !== saved.connection.scopeId) throw new ApiError({ code: 'SESSION_EXPIRED' });
      if (saved && !(await savedSessionStore.isCurrent(saved.revision))) {
        if (generation === runtime.current.generation) {
          stop();
          setRemembered(false);
        }
        return;
      }
      if (generation !== runtime.current.generation) return;
      await db.connections.put(next);
      if (generation !== runtime.current.generation) return;
      if (remember) {
        try {
          await savedSessionStore.save(next, token, () => generation === runtime.current.generation);
          if (generation === runtime.current.generation) setRemembered(true);
        } catch {
          if (generation === runtime.current.generation) setNotice('sessionNotSaved');
        }
      }
      if (generation !== runtime.current.generation) return;
      const acquired = await lock(next);
      if (generation !== runtime.current.generation) return;
      setConnection(next);
      setClient(adapter);
      if (acquired) {
        const sync = new SyncEngine(db, adapter, next);
        runtime.current.engine = sync;
        setEngine(sync);
        void sync.start().catch(() => {});
      }
      void navigator.storage?.persist?.().catch(() => false);
    } catch (error) {
      if (generation === runtime.current.generation) runtime.current.credentials.clear();
      throw error;
    }
  }
  async function openOffline(next: Connection) {
    const previous = runtime.current.generation;
    await flushAllDrafts();
    if (previous !== runtime.current.generation) return;
    stop();
    const generation = runtime.current.generation;
    await forget();
    if (generation !== runtime.current.generation) return;
    await lock(next);
    if (generation === runtime.current.generation) setConnection(next);
  }
  async function forget() {
    try {
      await savedSessionStore.forget();
      setRemembered(false);
    } catch {
      setNotice('sessionForgetFailed');
      throw new Error('Saved session could not be removed');
    }
  }
  async function disconnect() {
    stop();
    await forget();
  }
  async function leave() {
    const previous = runtime.current.generation;
    await flushAllDrafts();
    if (previous !== runtime.current.generation) return;
    await disconnect();
    runtime.current.release();
    runtime.current.lockScope = null;
    setLockState('busy');
    setConnection(null);
  }
  const resume = useEffectEvent(async () => {
    const saved = runtime.current.saved;
    if (!saved || runtime.current.resuming || !navigator.onLine || Date.now() < runtime.current.retryAt)
      return;
    runtime.current.resuming = true;
    const generation = runtime.current.generation;
    try {
      await flushAllDrafts();
      if (generation !== runtime.current.generation) return;
      setNotice('');
      await establish(
        `${saved.connection.owner}/${saved.connection.repo}`,
        saved.token,
        generation,
        false,
        saved,
      );
      if (generation === runtime.current.generation) runtime.current.saved = null;
    } catch (error) {
      if (generation !== runtime.current.generation) return;
      const code = error instanceof ApiError ? error.code : 'sessionRestoreFailed';
      setNotice(code);
      runtime.current.retryAt =
        error instanceof ApiError && error.failure.retryAt ? Date.parse(error.failure.retryAt) || 0 : 0;
      if (
        [
          'AUTH_REQUIRED',
          'FORBIDDEN',
          'NOT_FOUND_OR_INACCESSIBLE',
          'ISSUES_DISABLED',
          'PRIVATE_REQUIRED',
          'OWNER_REQUIRED',
          'ARCHIVED_REPOSITORY',
          'SESSION_EXPIRED',
          'VALIDATION_FAILED',
        ].includes(code)
      ) {
        runtime.current.saved = null;
        try {
          await savedSessionStore.forget(saved.revision);
          if (generation === runtime.current.generation) setRemembered(false);
        } catch {
          if (generation === runtime.current.generation) setNotice('sessionForgetFailed');
        }
      }
    } finally {
      if (generation === runtime.current.generation) runtime.current.resuming = false;
    }
  });
  const takingLock = useRef(false);
  async function takeLock() {
    if (!connection || lockState === 'acquired' || takingLock.current) return;
    takingLock.current = true;
    try {
      if (!(await lock(connection))) return;
      if (client) {
        const sync = new SyncEngine(db, client, connection);
        runtime.current.engine = sync;
        setEngine(sync);
        void sync.start().catch(() => {});
      }
    } finally {
      takingLock.current = false;
    }
  }
  useEffect(() => {
    const current = runtime.current;
    const generation = current.generation;
    const active = () => generation === current.generation;
    void (async () => {
      try {
        const saved = await savedSessionStore.restore();
        if (!saved || !active()) return;
        const cached = await db.connections.get(saved.connection.scopeId);
        if (!active()) return;
        if (!cached) {
          await savedSessionStore.forget(saved.revision);
          return;
        }
        await lock(cached);
        if (!active()) return;
        setConnection(cached);
        current.saved = saved;
        setRemembered(true);
        setRestoring(false);
        await resume();
      } catch {
        if (active()) setNotice('sessionRestoreFailed');
      } finally {
        if (active()) setRestoring(false);
      }
    })();
    const retry = () => {
      if (document.visibilityState === 'visible') void resume();
    };
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', retry);
    const timer = setInterval(retry, 60_000);
    return () => {
      current.generation++;
      current.engine?.stop();
      current.credentials.clear();
      current.saved = null;
      current.resuming = false;
      current.release();
      current.lockScope = null;
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', retry);
      clearInterval(timer);
    };
  }, []);
  return (
    <Context.Provider
      value={{
        connection,
        client,
        engine,
        connected: !!client,
        restoring,
        remembered,
        notice,
        writable: lockState === 'acquired' && !connection?.readOnly,
        lockState,
        connect,
        openOffline,
        disconnect,
        leave,
        takeLock,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useSession = () => useContext(Context);

type DraftFlushOptions = { finalizeEmptyTitle?: boolean };
const pendingEditors = new Set<(options?: DraftFlushOptions) => Promise<void>>();
export function registerDraftFlusher(flush: (options?: DraftFlushOptions) => Promise<void>) {
  pendingEditors.add(flush);
  return () => {
    pendingEditors.delete(flush);
  };
}
export async function flushAllDrafts(options?: DraftFlushOptions) {
  for (const flush of pendingEditors) await flush(options);
}
