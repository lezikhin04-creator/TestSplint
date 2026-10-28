import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionResponse } from '@splint/shared';
import { api, bootstrapRequestId, errorMessage, setApiSession } from './lib/api';
import { telegramUi } from './lib/telegram';
import { Icon, PixelMark } from './components/Icon';
import { BrandFlower, Button, Loading } from './components/UI';
import { Catalog, CreateView, PaintView, Profile, Settings, Support, Terms, WorkDetail, catalogViewState } from './views';
import type { LeaveGuard } from './views';

interface PublicConfig { devAuthEnabled: boolean; botUsername?: string }
const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

function currentPath() { return window.location.hash.startsWith('#/') ? window.location.hash.slice(1) : '/'; }

export default function App() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [config, setConfig] = useState<PublicConfig>({ devAuthEnabled: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [path, setPath] = useState(currentPath);
  const previousPath = useRef(currentPath());
  const [authBusy, setAuthBusy] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const leaveGuard = useRef<LeaveGuard>(null);
  const registerGuard = useCallback((guard: LeaveGuard) => { leaveGuard.current = guard; }, []);
  const updateSession = useCallback((value: SessionResponse) => { setSession(setApiSession(value)); }, []);

  useEffect(() => {
    const changed = () => {
      const next = currentPath();
      if (previousPath.current === '/' && next !== '/') catalogViewState.scroll = window.scrollY;
      previousPath.current = next;
      setPath(next);
      if (next !== '/') window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', changed);
    const webApp = window.Telegram?.WebApp;
    try {
      const native = telegramUi();
      native?.ready(); native?.expand();
      telegramUi('6.1')?.setBackgroundColor?.('#faf8f2');
      // Arbitrary header hex colors are supported from 6.9; older clients use a theme key.
      telegramUi('6.1')?.setHeaderColor?.(telegramUi('6.9') ? '#faf8f2' : 'bg_color');
    } catch { /* Optional appearance APIs must not prevent bootstrap. */ }
    if (!window.location.hash.startsWith('#/')) {
      const fromUrl = new URLSearchParams(window.location.search).get('work');
      const startParam = new URLSearchParams(webApp?.initData ?? '').get('start_param');
      const id = fromUrl ?? (startParam?.startsWith('work_') ? startParam.slice(5) : null);
      if (id && /^[A-Za-z0-9_-]{1,100}$/.test(id)) window.location.hash = `/work/${encodeURIComponent(id)}`;
    }
    return () => window.removeEventListener('hashchange', changed);
  }, []);

  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    setLoading(true); setError('');
    const load = async () => {
      try {
        const publicConfig = await api<PublicConfig>('/config', { signal: abort.signal });
        if (active) setConfig(publicConfig);
        try {
          const existing = await api<SessionResponse>('/me', { signal: abort.signal });
          if (active) updateSession(existing);
          return;
        } catch (cause) {
          if (abort.signal.aborted) return;
          // A network or server error is retriable. Only a missing session needs bootstrap.
          if (!(cause instanceof Error && 'status' in cause && cause.status === 401)) throw cause;
        }
        const initData = window.Telegram?.WebApp.initData;
        if (initData) {
          const requestId = await bootstrapRequestId(initData);
          if (!active) return;
          const authenticated = await api<SessionResponse>('/auth/telegram', {
            method: 'POST', body: { initData, bootstrapRequestId: requestId }, key: requestId, signal: abort.signal,
          });
          if (active) updateSession(authenticated);
        }
      } catch (cause) { if (active && !abort.signal.aborted) setError(errorMessage(cause)); }
      finally { if (active) setLoading(false); }
    };
    void load();
    return () => { active = false; abort.abort(); };
  }, [retry, updateSession]);

  const navigate = useCallback((next: string) => {
    const action = () => {
      leaveGuard.current = null;
      if (currentPath() === next) { setPath(next); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      else window.location.hash = next;
    };
    if (leaveGuard.current) leaveGuard.current(action); else action();
  }, []);
  const decoded = (() => { try { return decodeURIComponent(path.split('?')[0] ?? '/'); } catch { return '/'; } })();
  const painting = decoded.startsWith('/run/');
  const tab = decoded.startsWith('/create') ? 'create' : decoded.startsWith('/profile') || decoded.startsWith('/settings') || decoded.startsWith('/support') || decoded.startsWith('/terms') ? 'profile' : 'catalog';
  useEffect(() => {
    const button = telegramUi('6.1')?.BackButton;
    if (!button) return;
    const back = () => navigate(painting ? '/profile' : tab === 'profile' && decoded !== '/profile' ? '/profile' : '/');
    if (decoded !== '/') { button.show(); button.onClick(back); }
    else button.hide();
    return () => button.offClick(back);
  }, [decoded, navigate, painting, tab]);

  const demo = async () => {
    if (!config.devAuthEnabled || !localHost) return;
    setAuthBusy(true); setError('');
    try { updateSession(await api<SessionResponse>('/auth/dev', { method: 'POST', body: {} })); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setAuthBusy(false); }
  };
  const consent = async () => {
    setAuthBusy(true); setError('');
    try { updateSession(await api<SessionResponse>('/me/consent', { method: 'POST', body: { version: 'test-v1' } })); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setAuthBusy(false); }
  };
  const logout = async () => {
    setLogoutError('');
    try {
      await api('/auth/logout', { method: 'POST', body: {} });
      setApiSession(null); setSession(null); navigate('/');
    } catch (cause) { setLogoutError(errorMessage(cause)); }
  };

  if (loading) return <div className="app-boot"><div className="wordmark"><PixelMark size={36} /><span>splint<span className="logo-dot">.</span></span></div><Loading label="Находим немного вдохновения…" /></div>;
  if (!session) return <AuthGate canDemo={config.devAuthEnabled && localHost} botUsername={config.botUsername} error={error} busy={authBusy} onDemo={() => void demo()} retry={() => setRetry(value => value + 1)} />;
  if (session.consentRequired) return <Onboarding busy={authBusy} error={error} onConsent={() => void consent()} />;

  let screen;
  if (decoded.startsWith('/work/')) screen = <WorkDetail key={decoded} id={decoded.slice(6)} navigate={navigate} />;
  else if (painting) screen = <PaintView key={decoded} id={decoded.slice(5)} userId={session.user.id} navigate={navigate} registerGuard={registerGuard} botUsername={config.botUsername} />;
  else if (decoded === '/profile') screen = <Profile session={session} navigate={navigate} />;
  else if (decoded === '/create') screen = <CreateView />;
  else if (decoded === '/support') screen = <Support key={path} workId={new URLSearchParams(path.split('?')[1]).get('work') ?? undefined} navigate={navigate} />;
  else if (decoded === '/settings') screen = <><Settings session={session} updateSession={updateSession} navigate={navigate} onLogout={() => void logout()} />{logoutError && <p className="inline-error" role="alert">{logoutError}</p>}</>;
  else if (decoded === '/terms') screen = <Terms navigate={navigate} />;
  else screen = <Catalog navigate={navigate} />;

  return <div className={`app-shell ${painting ? 'painting-shell' : ''}`}><header className="site-header"><button className="wordmark" onClick={() => navigate('/')} aria-label="Splint — в каталог"><PixelMark size={30} /><span>splint<span className="logo-dot">.</span></span></button>{painting ? <span className="header-paint-note">Никуда не торопимся.</span> : <nav className="desktop-nav" aria-label="Основная навигация"><button className={tab === 'catalog' ? 'active' : ''} onClick={() => navigate('/')}><Icon name="grid" size={17} />Каталог</button><button className={tab === 'create' ? 'active' : ''} onClick={() => navigate('/create')}><Icon name="sparkles" size={17} />Создание</button><button className={tab === 'profile' ? 'active' : ''} onClick={() => navigate('/profile')}><Icon name="user" size={17} />Профиль</button></nav>}<div className="header-right"><span className="test-label"><i />{session.mode === 'demo' ? 'LOCAL DEMO' : 'TEST EDITION'}</span><button className="header-avatar" onClick={() => navigate('/profile')} aria-label="Открыть профиль">{session.user.displayName.slice(0, 1).toLocaleUpperCase()}</button></div></header><main className="main-content">{screen}</main>{!painting && <><footer className="site-footer"><span>© Splint · Маленькое творчество каждый день</span><button onClick={() => navigate('/support')}>Мы рядом <Icon name="arrow" size={14} /></button></footer><nav className="bottom-nav" aria-label="Вкладки приложения">{([{ tab: 'catalog', route: '/', label: 'Каталог', icon: 'grid' }, { tab: 'create', route: '/create', label: 'Создание', icon: 'sparkles' }, { tab: 'profile', route: '/profile', label: 'Профиль', icon: 'user' }] as const).map(item => <button key={item.tab} className={tab === item.tab ? 'active' : ''} aria-current={tab === item.tab ? 'page' : undefined} onClick={() => navigate(item.route)}><Icon name={item.icon} size={21} /><span>{item.label}</span></button>)}</nav></>}</div>;
}

function AuthGate({ canDemo, botUsername, error, busy, onDemo, retry }: { canDemo: boolean; botUsername?: string; error: string; busy: boolean; onDemo: () => void; retry: () => void }) {
  return <div className="welcome-page"><div className="wordmark"><PixelMark size={33} /><span>splint<span className="logo-dot">.</span></span></div><div className="welcome-art"><BrandFlower /><span className="welcome-sparkle"><Icon name="sparkles" size={32} /></span></div><span className="eyebrow">ТВОЯ МАЛЕНЬКАЯ ТВОРЧЕСКАЯ ПАУЗА</span><h1>Мир чуть ярче.<br />Пиксель за пикселем.</h1><p>Раскрашивай, выдыхай, собирай любимое.<br />Открой Splint в Telegram, чтобы сохранить свою коллекцию.</p>{error && <p className="inline-error auth-error" role="alert">{error}</p>}{botUsername && /^[A-Za-z0-9_]+$/.test(botUsername) && <a className="button button-primary" href={`https://t.me/${botUsername}?startapp`} target="_blank" rel="noopener noreferrer">Открыть в Telegram <Icon name="arrow" size={18} /></a>}{canDemo && <Button onClick={onDemo} disabled={busy} variant={botUsername ? 'secondary' : 'primary'}>{busy ? 'Входим…' : 'Открыть локальную демоверсию'}<Icon name="arrow" size={18} /></Button>}<button className="subtle-link" onClick={retry}>Повторить вход</button>{!canDemo && <small className="auth-note">Если вход устарел, закрой Mini App и открой его из бота заново.</small>}{canDemo && <small className="auth-note">Локальная проверка интерфейса с тестовым профилем.<br />Не является входом в реальный Telegram-аккаунт.</small>}</div>;
}

function Onboarding({ busy, error, onConsent }: { busy: boolean; error: string; onConsent: () => void }) {
  const [accepted, setAccepted] = useState(false);
  const [details, setDetails] = useState(false);
  return <div className="welcome-page onboarding"><div className="wordmark"><PixelMark size={33} /><span>splint<span className="logo-dot">.</span></span></div><div className="welcome-art small"><BrandFlower /></div><span className="eyebrow">ПРИВЕТ. ЭТО ТЕСТОВЫЙ SPLINT.</span><h1>Здесь можно<br />просто быть собой.</h1><p>Выбери картину, найди цвета по номерам<br />и забери готовый результат в свою коллекцию.</p><div className="onboarding-points"><span><Icon name="heart" size={18} /> Всё в этом тесте бесплатно</span><span><Icon name="save" size={18} /> Прогресс сохраняется в профиле</span><span><Icon name="shield" size={18} /> Отправка картин — только по твоему желанию</span></div><div className="test-terms"><button onClick={() => setDetails(value => !value)} aria-expanded={details}>Условия теста и приватность <Icon name={details ? 'minus' : 'plus'} size={17} /></button>{details && <div><p>Редакция test-v1. Приложение сохраняет идентификатор Telegram, имя, настройки, прогресс и результаты раскрашивания. Изменения без связи могут храниться в браузере этого устройства. Профиль и коллекция не публикуются автоматически.</p><p>Реальные покупки, подписки и пользовательские публикации отключены. Это тест, в котором возможны согласованные изменения и сброс тестовых данных. Условия публичного сервиса и сроки хранения утверждаются отдельно.</p><p>Обращения и запрос удаления доступны в разделе помощи. Раскрашивание не передает авторские права на исходный рисунок.</p></div>}<label className="check-field"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} /><span>Я понимаю, что это тестовая версия, и принимаю условия test-v1.</span></label></div>{error && <p className="inline-error" role="alert">{error}</p>}<Button disabled={!accepted || busy} onClick={onConsent}>{busy ? 'Сохраняем…' : 'Начать маленькое приключение'}<Icon name="arrow" size={18} /></Button><span className="auth-note">Необязательные уведомления можно включить в настройках.</span></div>;
}
