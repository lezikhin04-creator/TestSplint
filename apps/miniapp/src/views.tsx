import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { ArtworkSummary, LibraryItem, PixelGrid, RunState, SessionResponse } from '@splint/shared';
import { api, downloadResult, errorMessage } from './lib/api';
import { telegramUi } from './lib/telegram';
import { useProgress } from './hooks/useProgress';
import ColoringCanvas from './components/ColoringCanvas';
import { Icon, PixelMark } from './components/Icon';
import { BrandFlower, Button, EmptyState, ErrorPanel, Loading, Modal } from './components/UI';

export type Navigate = (path: string) => void;
export type LeaveGuard = ((next: () => void) => void) | null;

// UI-only memory for this visit. No account data or credentials are persisted.
export const catalogViewState = { query: '', category: 'Все', size: '', sort: 'curated', scroll: 0, items: [] as ArtworkSummary[] };

function ArtworkImage({ work, className = '' }: { work: ArtworkSummary; className?: string }) {
  return <img className={`artwork-image ${className}`} src={work.previewUrl} alt={work.title} loading="lazy" draggable={false} />;
}

export function WorkCard({ work, navigate }: { work: ArtworkSummary; navigate: Navigate }) {
  const colors = ['peach', 'sage', 'lilac', 'sky', 'butter'];
  const tone = colors[[...work.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % colors.length];
  return <button className={`work-card tone-${tone}`} onClick={() => navigate(`/work/${encodeURIComponent(work.id)}`)} aria-label={`Открыть «${work.title}»`}>
    <div className="work-art"><ArtworkImage work={work} /><span className={`work-badge ${work.status === 'completed' ? 'badge-completed' : ''}`}>{work.status === 'completed' ? <><Icon name="check" size={13} /> В коллекции</> : work.status === 'in_progress' ? `${Math.floor(work.progress)}% готово` : 'Бесплатно'}</span><span className="work-open"><Icon name="arrow" size={19} /></span></div>
    <div className="work-info"><h3>{work.title}</h3><div className="work-meta"><span>{work.category}</span><span>{work.width} × {work.height}<i />{work.colorCount} цветов</span></div></div>
    {work.status === 'in_progress' && <span className="card-progress"><i style={{ width: `${work.progress}%` }} /></span>}
  </button>;
}

export function Catalog({ navigate }: { navigate: Navigate }) {
  const [items, setItems] = useState<ArtworkSummary[]>(catalogViewState.items);
  const [query, setQuery] = useState(catalogViewState.query);
  const [category, setCategory] = useState(catalogViewState.category);
  const [size, setSize] = useState(catalogViewState.size);
  const [sort, setSort] = useState(catalogViewState.sort);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    Object.assign(catalogViewState, { query, category, size, sort, items });
  }, [query, category, size, sort, items]);
  useEffect(() => {
    const restore = window.requestAnimationFrame(() => window.scrollTo({ top: catalogViewState.scroll, behavior: 'instant' }));
    return () => window.cancelAnimationFrame(restore);
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true); setError('');
      const params = new URLSearchParams({ q: query, size, sort });
      void api<{ items: ArtworkSummary[] }>(`/catalog?${params}`, { signal: abort.signal }).then(data => {
        if (!abort.signal.aborted) { setItems(data.items); setLoading(false); }
      }).catch(cause => { if (!abort.signal.aborted) { setError(errorMessage(cause)); setLoading(false); } });
    }, query ? 220 : 0);
    return () => { abort.abort(); window.clearTimeout(timer); };
  }, [query, size, sort, retry]);
  const categories = ['Все', ...new Set(items.map(work => work.category))];
  const visible = category === 'Все' ? items : items.filter(work => work.category === category);
  const featured = items.find(work => work.featured) ?? items[0];
  return <div className="catalog-page page-enter">
    <section className="hero">
      <div className="hero-copy"><span className="eyebrow"><span className="tiny-dot" /> МАЛЕНЬКОЕ ТВОРЧЕСТВО КАЖДЫЙ ДЕНЬ</span><h1>Немного цвета.<br /><span>Много твоего.</span></h1><p>Отключись от суеты. Раскрашивай по номерам<br className="desktop-only" /> и собирай маленькие миры в свою коллекцию.</p><a className="button button-primary" href="#gallery" onClick={event => { event.preventDefault(); document.getElementById('gallery')?.scrollIntoView({ behavior: 'smooth' }); }}>Найти свою картину <Icon name="arrow" size={19} /></a><div className="hero-note"><span className="mini-pixel-art"><PixelMark size={16} /></span>Один пиксель — уже начало.</div></div>
      <div className="hero-visual" aria-hidden={!featured}>
        <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" />
        <span className="hero-star star-one"><Icon name="sparkles" size={38} /></span><span className="hero-star star-two"><Icon name="plus" size={26} /></span>
        <span className="hero-sticker"><Icon name="sun" size={16} /> В твоём ритме</span>
        {featured ? <button className="hero-frame" onClick={() => navigate(`/work/${encodeURIComponent(featured.id)}`)} aria-label={`Раскрасить «${featured.title}»`}><div className="hero-art"><ArtworkImage work={featured} /></div><div className="hero-caption"><span><small>ВЫБОР SPLINT</small><strong>{featured.title}</strong></span><span className="hero-caption-arrow"><Icon name="arrow" size={22} /></span></div></button> : <div className="hero-frame hero-placeholder"><BrandFlower /><span>Твоя следующая маленькая радость</span></div>}
        <span className="hero-floating-note"><span>✦</span> Сделано из пикселей.<br />Собрано тобой.</span>
      </div>
    </section>
    <section id="gallery" className="gallery-section">
      <div className="section-heading"><div><span className="eyebrow">КАТАЛОГ</span><h2>Что раскрасим сегодня?</h2></div><span className="section-note">Никаких дедлайнов.<br />Только любимые цвета.</span></div>
      <div className="gallery-toolbar"><label className="search-field"><Icon name="search" /><input value={query} onChange={event => { setQuery(event.target.value); setCategory('Все'); }} placeholder="Найти что-нибудь прекрасное" aria-label="Поиск картин" />{query && <button onClick={() => setQuery('')} aria-label="Очистить поиск"><Icon name="close" size={16} /></button>}</label><div className="gallery-selects"><label><span className="sr-only">Размер сетки</span><select value={size} onChange={event => { setSize(event.target.value); setCategory('Все'); }}><option value="">Любой размер</option>{[8, 12, 16, 24, 32, 48, 64].map(n => <option key={n} value={n}>{n} × {n}</option>)}</select></label><label><span className="sr-only">Сортировка</span><select value={sort} onChange={event => setSort(event.target.value)}><option value="curated">Выбор редакции</option><option value="new">Сначала новые</option></select></label></div></div>
      <div className="category-row" aria-label="Категории">{categories.map((label, index) => <button className={`category-chip ${category === label ? 'selected' : ''}`} key={label} onClick={() => setCategory(label)}>{index === 0 && <Icon name="grid" size={15} />}{label}</button>)}<span className="gallery-count">{loading ? 'Обновляем…' : `${visible.length} ${plural(visible.length, 'работа', 'работы', 'работ')}`}</span></div>
      {error ? <ErrorPanel message={error} retry={() => setRetry(value => value + 1)} /> : loading && !items.length ? <div className="work-grid skeleton-grid" aria-label="Загрузка каталога">{[0, 1, 2, 3].map(n => <div className="skeleton-card" key={n}><i /><span /><small /></div>)}</div> : !visible.length ? <EmptyState title="Здесь пока тихо" icon="search" action={<Button variant="secondary" onClick={() => { setQuery(''); setSize(''); setCategory('Все'); }}>Сбросить фильтры</Button>}>Попробуйте другое название или выберите все категории.</EmptyState> : <div className={`work-grid ${loading ? 'is-refreshing' : ''}`}>{visible.map(work => <WorkCard key={work.id} work={work} navigate={navigate} />)}</div>}
    </section>
    <section className="slow-banner"><span className="banner-symbol"><PixelMark size={34} /></span><div><h3>Не нужно уметь рисовать.</h3><p>Нужны только ты, несколько цветов и немного свободного времени.</p></div><span className="banner-heart"><Icon name="heart" size={35} /></span></section>
  </div>;
}

function plural(value: number, one: string, few: string, many: string) { return value % 10 === 1 && value % 100 !== 11 ? one : value % 10 >= 2 && value % 10 <= 4 && (value % 100 < 12 || value % 100 > 14) ? few : many; }

export function WorkDetail({ id, navigate }: { id: string; navigate: Navigate }) {
  const [work, setWork] = useState<ArtworkSummary | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setError('');
    void api<{ work: ArtworkSummary }>(`/works/${encodeURIComponent(id)}`, { signal: abort.signal }).then(data => setWork(data.work)).catch(cause => { if (!abort.signal.aborted) setError(errorMessage(cause)); });
    return () => abort.abort();
  }, [id, retry]);
  const start = async () => {
    setStarting(true); setError('');
    try {
      const data = await api<{ run: RunState; grid: PixelGrid }>(`/works/${encodeURIComponent(id)}/start`, { method: 'POST', body: {} });
      navigate(`/run/${encodeURIComponent(data.run.id)}`);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setStarting(false); }
  };
  return <div className="detail-page page-enter"><button className="back-link" onClick={() => navigate('/')}><Icon name="back" size={18} /> В каталог</button>{!work ? error ? <ErrorPanel message={error} retry={() => setRetry(value => value + 1)} /> : <Loading /> : <div className="detail-layout"><div className="detail-art"><ArtworkImage work={work} /><span className="detail-art-label">ПИКСЕЛЬ-АРТ • SPLINT ORIGINALS</span></div><div className="detail-copy"><span className="eyebrow">{work.category} / КОЛЛЕКЦИЯ SPLINT</span><h1>{work.title}</h1><p className="detail-description">{work.description}</p><div className="author-line"><span className="author-icon"><PixelMark size={18} /></span><span>Автор работы<strong>{work.author}</strong></span></div><div className="art-facts"><div><Icon name="grid" /><strong>{work.width} × {work.height}</strong><span>пикселей</span></div><div><Icon name="sun" /><strong>{work.colorCount}</strong><span>{plural(work.colorCount, 'цвет', 'цвета', 'цветов')}</span></div><div><Icon name="heart" /><strong>Бесплатно</strong><span>в тестовой версии</span></div></div>{work.status === 'in_progress' && <div className="detail-progress"><span>Твоя картина уже на {Math.floor(work.progress)}% готова</span><div className="progress-track"><i style={{ width: `${work.progress}%` }} /></div></div>}{error && <p className="inline-error" role="alert">{error}</p>}<Button className="full-width" onClick={() => void start()} disabled={starting}>{starting ? 'Открываем холст…' : work.status === 'completed' ? 'Посмотреть мой результат' : work.status === 'in_progress' ? 'Продолжить раскрашивать' : 'Начать раскрашивать'}<Icon name="arrow" /></Button><p className="button-note"><Icon name="shield" size={15} /> Прогресс сохраняется. Готовая картина — в твоей коллекции.</p><button className="subtle-link" onClick={() => navigate(`/support?work=${encodeURIComponent(work.id)}`)}>Сообщить о проблеме с работой</button></div></div>}</div>;
}

export function PaintView({ id, userId, navigate, registerGuard, botUsername }: { id: string; userId: string; navigate: Navigate; registerGuard: (guard: LeaveGuard) => void; botUsername?: string }) {
  const [data, setData] = useState<{ run: RunState; grid: PixelGrid } | null>(null);
  const [work, setWork] = useState<ArtworkSummary | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setError(''); setData(null);
    void api<{ run: RunState; grid: PixelGrid }>(`/runs/${encodeURIComponent(id)}`, { signal: abort.signal }).then(async value => {
      if (abort.signal.aborted) return;
      setData(value);
      const result = await api<{ work: ArtworkSummary }>(`/works/${encodeURIComponent(value.run.workId)}`, { signal: abort.signal });
      if (!abort.signal.aborted) setWork(result.work);
    }).catch(cause => { if (!abort.signal.aborted) setError(errorMessage(cause)); });
    return () => abort.abort();
  }, [id, retry]);
  if (error && (!data || !work)) return <div className="page-section"><button className="back-link" onClick={() => navigate('/profile')}><Icon name="back" /> В профиль</button><ErrorPanel message={error} retry={() => setRetry(value => value + 1)} /></div>;
  if (!data || !work) return <Loading label="Готовим твой холст…" />;
  return <Painter key={data.run.id} initialRun={data.run} grid={data.grid} work={work} userId={userId} navigate={navigate} registerGuard={registerGuard} botUsername={botUsername} />;
}

function Painter({ initialRun, grid, work, userId, navigate, registerGuard, botUsername }: {
  initialRun: RunState; grid: PixelGrid; work: ArtworkSummary; userId: string; navigate: Navigate; registerGuard: (guard: LeaveGuard) => void; botUsername?: string;
}) {
  const progress = useProgress(userId, initialRun, grid);
  const [selected, setSelected] = useState(0);
  const [tip, setTip] = useState('');
  const [leaveAction, setLeaveAction] = useState<(() => void) | null>(null);
  const [restartOpen, setRestartOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState('');
  const timer = useRef(0);
  const filled = useMemo(() => new Set([...progress.run.filled, ...progress.pendingIndices]), [progress.run.filled, progress.pendingIndices]);
  const remaining = useMemo(() => grid.palette.map((_, color) => grid.cells.reduce((count, cell, index) => count + (grid.mask[index] && cell === color && !filled.has(index) ? 1 : 0), 0)), [grid, filled]);
  const percentage = progress.run.status === 'completed' ? 100 : Math.min(99, Math.floor(filled.size / progress.run.total * 100));
  const hasPending = progress.pendingIndices.size > 0;
  const complete = progress.run.status === 'completed';

  useEffect(() => {
    const first = remaining.findIndex(value => value > 0);
    if (remaining[selected] === 0 && first !== -1) setSelected(first);
  }, [remaining, selected]);
  useEffect(() => {
    registerGuard(hasPending ? next => { void progress.flush(); setLeaveAction(() => next); } : null);
    return () => registerGuard(null);
  }, [hasPending, progress.flush, registerGuard]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => { if (complete) telegramUi('6.1')?.HapticFeedback?.notificationOccurred('success'); }, [complete]);
  const wrongColor = useCallback(() => {
    setTip('Выбери цвет с таким же номером, как на клетке');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setTip(''), 2600);
  }, []);
  const restart = async () => {
    setRestarting(true); setRestartError('');
    try {
      if (hasPending && !await progress.flush()) { setRestartError('Сначала нужно сохранить текущие изменения. Проверьте соединение.'); return; }
      const result = await api<{ run: RunState; grid: PixelGrid }>(`/runs/${encodeURIComponent(initialRun.id)}/restart`, { method: 'POST', body: {} });
      registerGuard(null); setRestartOpen(false); navigate(`/run/${encodeURIComponent(result.run.id)}`);
    } catch (cause) { setRestartError(errorMessage(cause)); }
    finally { setRestarting(false); }
  };
  const closeLeave = useCallback(() => setLeaveAction(null), []);
  const closeRestart = useCallback(() => { if (!restarting) setRestartOpen(false); }, [restarting]);
  if (complete) return <Completion work={work} run={progress.run} navigate={navigate} onRestart={() => setRestartOpen(true)} botUsername={botUsername} modal={restartOpen ? <Modal title="Ещё раз, с удовольствием?" onClose={closeRestart}><p>Текущая картина останется в коллекции. Новое прохождение начнется с чистого холста.</p>{restartError && <p className="inline-error">{restartError}</p>}<div className="modal-actions"><Button variant="secondary" onClick={closeRestart} disabled={restarting}>Оставить как есть</Button><Button onClick={() => void restart()} disabled={restarting}>{restarting ? 'Открываем…' : 'Начать заново'}</Button></div></Modal> : null} />;
  return <div className="paint-page page-enter"><div className="paint-heading"><button className="icon-button" aria-label="Назад к картине" onClick={() => navigate(`/work/${encodeURIComponent(work.id)}`)}><Icon name="back" /></button><div><span className="eyebrow">МОМЕНТ ДЛЯ СЕБЯ</span><h1>{work.title}</h1></div><button className="icon-button" aria-label="Начать заново" onClick={() => setRestartOpen(true)}><Icon name="reset" /></button></div><div className="paint-layout"><div className="paint-main"><ColoringCanvas grid={grid} filled={filled} selectedColor={selected} onPaint={progress.paint} disabled={!progress.ready || progress.blocked} onWrongColor={wrongColor} /><div className={`save-strip ${progress.error || !progress.online ? 'save-warning' : ''}`} role="status"><span><Icon name={progress.saving ? 'clock' : hasPending || !progress.online ? 'wifi' : 'check'} size={16} />{!progress.ready ? 'Восстанавливаем изменения…' : progress.saving ? 'Сохраняем…' : !progress.online ? 'Без сети · изменения на этом устройстве' : hasPending ? 'Изменения ещё не сохранены' : 'Все изменения сохранены'}</span>{hasPending && !progress.saving && <button onClick={() => void progress.flush()}>Сохранить</button>}</div>{progress.localStorageError && <p className="inline-error">Локальное хранилище недоступно. Не закрывайте страницу до подтверждения сохранения на сервере.</p>}{progress.error && <div className="paint-error" role="alert">{progress.error}{progress.blocked && <button className="subtle-link" onClick={() => navigate('/profile')}>Вернуться в профиль</button>}</div>}</div><aside className="palette-panel"><div className="palette-progress"><span>Пиксель за пикселем</span><strong>{percentage}<small>%</small></strong><div className="progress-track"><i style={{ width: `${percentage}%` }} /></div><span className="progress-caption">{filled.size} из {progress.run.total} клеток</span></div><div className="palette-title"><h2>Твоя палитра</h2><span>{grid.palette.length} цветов</span></div><p className="palette-instruction">Выбери цвет. Найди такой же номер.</p><div className="palette-colors" role="group" aria-label="Палитра">{grid.palette.map((color, index) => <button key={index} className={`color-option ${selected === index ? 'selected' : ''} ${remaining[index] === 0 ? 'color-finished' : ''}`} style={{ '--swatch': color, '--swatch-text': swatchText(color) } as CSSProperties} aria-label={`Цвет ${index + 1}, осталось ${remaining[index]} клеток`} aria-pressed={selected === index} onClick={() => { setSelected(index); telegramUi('6.1')?.HapticFeedback?.selectionChanged(); }}><span className="swatch">{remaining[index] === 0 ? <Icon name="check" size={18} /> : index + 1}</span><small>{remaining[index] === 0 ? 'Готово' : remaining[index]}</small></button>)}</div><div className="paint-tip" aria-live="polite"><Icon name="sparkles" size={20} /><p>{tip || 'Здесь не бывает ошибок. Не тот цвет просто не закрасит клетку.'}</p></div></aside></div>{leaveAction && <Modal title="Сохраним маленький прогресс?" onClose={closeLeave}><p>Часть изменений ещё не подтверждена сервером. Они останутся на этом устройстве, если локальное хранилище доступно.</p><div className="modal-actions"><Button variant="secondary" onClick={() => { const action = leaveAction; setLeaveAction(null); registerGuard(null); action(); }}>Выйти без подтверждения</Button><Button onClick={async () => { if (await progress.flush()) { const action = leaveAction; setLeaveAction(null); registerGuard(null); action(); } }} disabled={progress.saving}>{progress.saving ? 'Сохраняем…' : 'Сохранить и выйти'}</Button></div><button className="subtle-link" onClick={closeLeave}>Остаться на холсте</button></Modal>}{restartOpen && <Modal title="Начать с чистого холста?" onClose={closeRestart}><p>Текущее прохождение будет прервано. Результаты уже законченных прохождений останутся в коллекции.</p>{restartError && <p className="inline-error">{restartError}</p>}<div className="modal-actions"><Button variant="secondary" onClick={closeRestart} disabled={restarting}>Продолжить эту картину</Button><Button onClick={() => void restart()} disabled={restarting}>{restarting ? 'Открываем…' : 'Начать заново'}</Button></div></Modal>}</div>;
}

function swatchText(color: string) {
  const value = color.replace('#', '');
  const channels = value.length === 3 ? [...value].map(c => parseInt(c + c, 16)) : [0, 2, 4].map(start => parseInt(value.slice(start, start + 2), 16));
  return channels[0]! * .299 + channels[1]! * .587 + channels[2]! * .114 > 155 ? '#292531' : '#ffffff';
}

function Completion({ work, run, navigate, onRestart, botUsername, modal }: { work: ArtworkSummary; run: RunState; navigate: Navigate; onRestart: () => void; botUsername?: string; modal: ReactNode }) {
  const [action, setAction] = useState('');
  const [message, setMessage] = useState('');
  const exportImage = async () => {
    setAction('export'); setMessage('');
    try { await downloadResult(run.id, work.title); setMessage('Изображение подготовлено для сохранения.'); }
    catch (cause) { setMessage(errorMessage(cause)); }
    finally { setAction(''); }
  };
  const share = async () => {
    setAction('share'); setMessage('');
    try {
      const result = await api<{ url: string; preparedMessageId?: string }>(`/runs/${encodeURIComponent(run.id)}/share`, { method: 'POST', body: {} });
      const webApp = telegramUi('6.1');
      const sharingApp = telegramUi('8.0');
      if (result.preparedMessageId && sharingApp?.shareMessage) sharingApp.shareMessage(result.preparedMessageId, success => setMessage(success ? 'Картина отправлена.' : 'Отправка отменена. Картина осталась в коллекции.'));
      else if (result.url && navigator.share) await navigator.share({ title: work.title, text: `Я раскрасил(а) «${work.title}» в Splint. Попробуешь?`, url: result.url });
      else if (result.url && webApp?.openTelegramLink) webApp.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(result.url)}&text=${encodeURIComponent(`Моя маленькая картина в Splint — «${work.title}»`)}`);
      else if (result.url && navigator.clipboard) { await navigator.clipboard.writeText(result.url); setMessage('Ссылка скопирована. Теперь можно поделиться ей.'); }
      else setMessage('В локальной версии можно сохранить картину в PNG. Отправка появится при подключении тестового бота.');
    } catch (cause) { setMessage(cause instanceof DOMException && cause.name === 'AbortError' ? 'Отправка отменена. Картина осталась в коллекции.' : errorMessage(cause)); }
    finally { setAction(''); }
  };
  return <div className="completion-page page-enter"><span className="completion-kicker"><Icon name="check" size={16} /> ДОБАВЛЕНО В КОЛЛЕКЦИЮ</span><h1>Вот это — твоё.</h1><p className="completion-intro">Ещё один маленький мир, который ты наполнил(а) цветом.</p><div className="completed-frame"><ArtworkImage work={work} /><div><span><strong>{work.title}</strong><small>Автор: {work.author} · Раскрашено тобой</small></span><span className="completed-seal"><Icon name="check" /></span></div></div><div className="completion-actions">{botUsername && <Button onClick={() => void share()} icon="share" disabled={!!action}>{action === 'share' ? 'Готовим…' : 'Поделиться'}</Button>}<Button variant={botUsername ? 'secondary' : 'primary'} icon="download" onClick={() => void exportImage()} disabled={!!action}>{action === 'export' ? 'Готовим PNG…' : 'Сохранить картину'}</Button></div>{message && <p className="action-message" role="status">{message}</p>}<div className="completion-links"><button onClick={() => navigate('/profile')}>Моя коллекция <Icon name="arrow" size={16} /></button><button onClick={() => navigate('/')}>Выбрать следующую</button></div><button className="subtle-link" onClick={onRestart}>Раскрасить ещё раз</button>{modal}</div>;
}

export function Profile({ session, navigate }: { session: SessionResponse; navigate: Navigate }) {
  const [library, setLibrary] = useState<{ available: ArtworkSummary[]; inProgress: LibraryItem[]; collection: LibraryItem[] } | null>(null);
  const [tab, setTab] = useState<'collection' | 'inProgress' | 'available'>('collection');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setError('');
    void api<NonNullable<typeof library>>('/me/library', { signal: abort.signal }).then(setLibrary).catch(cause => { if (!abort.signal.aborted) setError(errorMessage(cause)); });
    return () => abort.abort();
  }, [retry]);
  const works = library ? tab === 'available' ? library.available : library[tab].map(item => ({ ...item.work, runId: item.run.id, progress: item.run.progress, status: tab === 'collection' ? 'completed' as const : 'in_progress' as const })) : [];
  return <div className="profile-page page-enter"><div className="profile-heading"><div className="profile-avatar">{session.user.avatarUrl ? <img src={session.user.avatarUrl} alt="" referrerPolicy="no-referrer" /> : <span>{session.user.displayName.slice(0, 1).toLocaleUpperCase()}</span>}<i><PixelMark size={12} /></i></div><div><span className="eyebrow">ТВОЙ УГОЛОК ТВОРЧЕСТВА</span><h1>{session.user.displayName}</h1><p>Маленькие шаги. Большая коллекция.</p></div><button className="icon-button profile-settings" aria-label="Настройки профиля" onClick={() => navigate('/settings')}><Icon name="settings" /></button></div><div className="profile-stats"><div><strong>{library?.collection.length ?? '—'}</strong><span>в коллекции</span></div><div><strong>{library?.inProgress.length ?? '—'}</strong><span>в процессе</span></div><div><strong>{library?.available.length ?? '—'}</strong><span>доступно</span></div></div><div className="profile-tabs" role="tablist" aria-label="Раздел профиля">{([{ id: 'collection', label: 'Моя коллекция', icon: 'grid' }, { id: 'inProgress', label: 'В процессе', icon: 'clock' }, { id: 'available', label: 'Доступные', icon: 'heart' }] as const).map(item => <button role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'selected' : ''} key={item.id} onClick={() => setTab(item.id)}><Icon name={item.icon} size={17} />{item.label}{library && <span>{library[item.id].length}</span>}</button>)}</div>{error ? <ErrorPanel message={error} retry={() => setRetry(value => value + 1)} /> : !library ? <Loading /> : works.length ? <div className="work-grid profile-grid">{works.map(work => <WorkCard key={work.id} work={work} navigate={path => work.runId ? navigate(`/run/${encodeURIComponent(work.runId)}`) : navigate(path)} />)}</div> : <EmptyState title={tab === 'collection' ? 'Первая картина будет особенной' : tab === 'inProgress' ? 'Здесь ждут маленькие продолжения' : 'Пусть появится любимая картина'} action={<Button onClick={() => navigate('/')} icon="arrow">Найти свою картину</Button>}>{tab === 'collection' ? 'Закончи любую раскраску — и она останется здесь. Пиксель за пикселем, это будет твоя история.' : tab === 'inProgress' ? 'Начни раскрашивать и возвращайся, когда захочется. Мы сохраним твой прогресс.' : 'Работы появляются здесь после первого нажатия «Раскрасить».'}</EmptyState>}<button className="profile-help" onClick={() => navigate('/support')}><Icon name="help" /><span>Нужна помощь?<small>Мы рядом, если что-то пошло не так.</small></span><Icon name="arrow" /></button></div>;
}

export function CreateView() {
  return <div className="create-page page-enter"><div className="create-art"><BrandFlower /><span className="floating-pixel one" /><span className="floating-pixel two" /><span className="floating-pixel three" /></div><span className="eyebrow">СЛЕДУЮЩАЯ ГЛАВА SPLINT</span><h1>От твоей идеи<br />до последнего пикселя.</h1><p>Здесь появится пространство для собственных картин: из любимой фотографии или с чистого холста.</p><div className="future-features"><div><Icon name="sun" /><strong>Из фотографии</strong><span>Памятные моменты<br />в новом цвете.</span></div><div><Icon name="brush" /><strong>Простой редактор</strong><span>Своя маленькая идея.<br />Своя большая свобода.</span></div></div><div className="coming-note"><span className="tiny-dot" /> Ещё создаём. В этом тесте доступно раскрашивание.</div></div>;
}

export function Support({ workId, navigate }: { workId?: string; navigate: Navigate }) {
  const [kind, setKind] = useState<'help' | 'content_report' | 'deletion'>(workId ? 'content_report' : 'help');
  const [message, setMessage] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const requestKey = useRef(crypto.randomUUID());
  const lastBody = useRef('');
  const submit = async () => {
    setSending(true); setError('');
    const body = { kind, message: message.trim(), ...(workId ? { workId } : {}) };
    const serialized = JSON.stringify(body);
    if (serialized !== lastBody.current) { requestKey.current = crypto.randomUUID(); lastBody.current = serialized; }
    try { const response = await api<{ id: string; status: string }>('/support', { method: 'POST', body, key: requestKey.current }); setResult(response.id); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setSending(false); }
  };
  return <div className="narrow-page page-enter"><button className="back-link" onClick={() => navigate('/profile')}><Icon name="back" size={18} /> В профиль</button><span className="eyebrow">МЫ РЯДОМ</span><h1>Давай разберёмся.</h1>{result ? <div className="form-success"><span className="empty-icon"><Icon name="check" size={30} /></span><h2>Обращение принято</h2><p>{kind === 'deletion' ? 'Это запрос на удаление, а не мгновенное удаление аккаунта. Поддержка уточнит последствия и обработает его.' : 'Мы получили сообщение. Сохраните номер обращения — он поможет найти его в поддержке.'}</p><code>{result}</code><Button variant="secondary" onClick={() => navigate('/profile')}>Вернуться в профиль</Button></div> : <form className="form-card" onSubmit={event => { event.preventDefault(); void submit(); }}><p>Расскажи, что случилось. Пожалуйста, не отправляй пароли, платежные данные или другие секреты.</p><label className="field-label">Тема<select value={kind} onChange={event => { setKind(event.target.value as typeof kind); setConfirmed(false); }}><option value="help">Помощь с приложением</option><option value="content_report">Пожаловаться на работу</option><option value="deletion">Запросить удаление аккаунта</option></select></label>{workId && <span className="context-tag">Работа прикреплена к обращению</span>}<label className="field-label">Что произошло?<textarea value={message} onChange={event => setMessage(event.target.value)} minLength={10} maxLength={2000} required rows={6} placeholder="Например: не получается продолжить картину после перезапуска…" /><span className="field-caption">{message.length} / 2000 · минимум 10 символов</span></label>{kind === 'deletion' && <label className="check-field"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>Я хочу запросить удаление профиля и понимаю, что поддержка сначала уточнит последствия для прогресса и коллекции.</span></label>}{error && <p className="inline-error" role="alert">{error}</p>}<Button type="submit" disabled={sending || message.trim().length < 10 || (kind === 'deletion' && !confirmed)}>{sending ? 'Отправляем…' : 'Отправить обращение'}<Icon name="arrow" size={18} /></Button></form>}</div>;
}

export function Settings({ session, updateSession, navigate, onLogout }: { session: SessionResponse; updateSession: (session: SessionResponse) => void; navigate: Navigate; onLogout: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const update = async (field: 'notifications' | 'shareName', value: boolean) => {
    setSaving(true); setError('');
    try { updateSession(await api<SessionResponse>('/me/preferences', { method: 'PATCH', body: { notifications: session.user.notifications, shareName: session.user.shareName, [field]: value } })); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setSaving(false); }
  };
  return <div className="narrow-page page-enter"><button className="back-link" onClick={() => navigate('/profile')}><Icon name="back" /> В профиль</button><span className="eyebrow">КАК УДОБНО ТЕБЕ</span><h1>Настройки.</h1><div className="settings-card"><label className="setting-row"><span><strong>Необязательные уведомления</strong><small>Напоминания от Splint. Раскрашивание доступно и без них.</small></span><input className="switch" type="checkbox" checked={session.user.notifications} disabled={saving} onChange={event => void update('notifications', event.target.checked)} /></label><label className="setting-row"><span><strong>Имя на карточке результата</strong><small>Показывать твоё имя при сохранении и отправке картины.</small></span><input className="switch" type="checkbox" checked={session.user.shareName} disabled={saving} onChange={event => void update('shareName', event.target.checked)} /></label><button className="setting-link" onClick={() => navigate('/terms')}><Icon name="shield" /><span>Условия тестовой версии и приватность</span><Icon name="chevron" size={18} /></button><button className="setting-link" onClick={() => navigate('/support')}><Icon name="help" /><span>Поддержка и запрос удаления</span><Icon name="chevron" size={18} /></button></div>{error && <p className="inline-error" role="alert">{error}</p>}<button className="subtle-link logout-button" onClick={onLogout}><Icon name="logout" size={17} /> Выйти из профиля</button></div>;
}

export function Terms({ navigate }: { navigate: Navigate }) {
  return <div className="narrow-page terms-page page-enter"><button className="back-link" onClick={() => navigate('/settings')}><Icon name="back" /> Назад</button><span className="eyebrow">РЕДАКЦИЯ TEST-V1</span><h1>Тестируем бережно.</h1><p className="lead">Это закрытая тестовая версия Splint. Здесь нет реальных покупок, подписок, публикации пользовательских работ или выплат.</p><div className="terms-card"><h2>Что сохраняется</h2><p>Идентификатор Telegram, отображаемое имя и настройки профиля, доступные работы, подтвержденный прогресс, результаты и сообщения в поддержку. Неподтвержденные изменения могут временно храниться в браузере этого устройства.</p><h2>Твои картины</h2><p>Завершенная раскраска остается в личной коллекции. Авторство исходного рисунка сохраняется за автором. Раскрашивание не передает право перепродажи или коммерческого использования изображения.</p><h2>Отправка и уведомления</h2><p>Картина отправляется только по твоему действию. Необязательные уведомления можно отключить. Профиль и прогресс не становятся публичными от просмотра каталога.</p><h2>Тестовые данные и удаление</h2><p>В тесте возможны изменения и сброс тестовых данных при согласованной подготовке новой версии. Не используй приложение для хранения единственной копии важных материалов. Запросить помощь или удаление можно через поддержку в профиле.</p><h2>До публичного запуска</h2><p>Рабочие условия сервиса, сроки хранения данных и ответственные за поддержку должны быть утверждены отдельно. Эта редакция описывает только текущий тест.</p></div></div>;
}
