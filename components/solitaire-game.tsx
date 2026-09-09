'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { HelpCircle, Lightbulb, Music, Music2, Play, Sparkles, Trophy, Undo2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  SUITS,
  autoMoveToFoundation,
  cardLabel,
  createGame,
  drawFromStock,
  findAutoFoundationMove,
  findHint,
  isReadyForAutoFinish,
  moveCards,
  rankLabel,
  restoreGame,
  serializeGame,
  suitSymbol,
  type Card,
  type CardSource,
  type CardTarget,
  type GameState,
} from '@/lib/solitaire';

const STORAGE_KEY = 'loopy-solitaire:game';
const PREFS_KEY = 'loopy-solitaire:preferences';
const BEST_KEY = 'loopy-solitaire:best';

const LOOPY_BY_RANK: Record<Card['rank'], { src: string; name: string }> = {
  1: { src: '/loopy/neutral.png', name: 'Neutral Loopy' },
  2: { src: '/loopy/intern.png', name: 'Intern Loopy' },
  3: { src: '/loopy/student.png', name: 'Student Loopy' },
  4: { src: '/loopy/part-timer.png', name: 'Part-timer Loopy' },
  5: { src: '/loopy/foodie.png', name: 'Foodie Loopy' },
  6: { src: '/loopy/office.png', name: 'Office Loopy' },
  7: { src: '/loopy/hoodie.png', name: 'Hoodie Loopy' },
  8: { src: '/loopy/auntie.png', name: 'Auntie Loopy' },
  9: { src: '/loopy/developer.png', name: 'Developer Loopy' },
  10: { src: '/loopy/surprised.webp', name: 'Surprised Loopy' },
  11: { src: '/loopy/boyfriend.png', name: 'Boyfriend Loopy' },
  12: { src: '/loopy/girlfriend.png', name: 'Girlfriend Loopy' },
  13: { src: '/loopy/manager.png', name: 'Manager Loopy' },
};

type SavedGame = { game: GameState; elapsed: number; started: boolean };
type BestResult = { seconds: number; moves: number; score: number };
type Reaction = 'neutral' | 'thinking' | 'surprised' | 'happy';

const sourceKey = (source: CardSource | null) => {
  if (!source) return '';
  if (source.type === 'tableau') return `tableau-${source.pile}-${source.index}`;
  if (source.type === 'foundation') return `foundation-${source.suit}`;
  return 'waste';
};

function assertEmptyToolInput(input: unknown) {
  if (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length > 0) {
    throw new Error('This action does not accept any input fields.');
  }
}

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function CardView({ card, selected, hinted, className = '', onClick, onDoubleClick, onDragStart, onDragEnd }: {
  card: Card;
  selected?: boolean;
  hinted?: boolean;
  className?: string;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onDragStart?: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDragEnd?: (event: React.DragEvent<HTMLButtonElement>) => void;
}) {
  if (!card.faceUp) {
    return (
      <button type="button" className={`playing-card card-back ${className}`} aria-label="Face-down card" onClick={onClick}>
        <span className="card-back-pattern" aria-hidden="true"><Image src="/loopy/neutral.png" alt="" fill sizes="100px" draggable={false} /></span>
      </button>
    );
  }
  const loopy = LOOPY_BY_RANK[card.rank];
  const red = card.suit === 'hearts' || card.suit === 'diamonds';
  return (
    <button
      type="button"
      className={`playing-card card-face suit-${card.suit} ${selected ? 'is-selected' : ''} ${hinted ? 'is-hinted' : ''} ${className}`}
      aria-label={`${cardLabel(card)}, face up${selected ? ', selected' : ''}`}
      aria-pressed={selected}
      data-card-id={card.id}
      draggable
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <span className={`card-corner top ${red ? 'red' : 'dark'}`} aria-hidden="true"><strong>{rankLabel(card.rank)}</strong><span>{suitSymbol(card.suit)}</span></span>
      <span className="card-art" aria-hidden="true"><span className="card-art-halo" /><Image src={loopy.src} alt="" fill sizes="100px" draggable={false} /></span>
      <span className={`card-corner bottom ${red ? 'red' : 'dark'}`} aria-hidden="true"><strong>{rankLabel(card.rank)}</strong><span>{suitSymbol(card.suit)}</span></span>
    </button>
  );
}

function EmptyPile({ label, symbol, onClick, onDrop }: { label: string; symbol?: string; onClick?: () => void; onDrop?: (source: CardSource) => void }) {
  return (
    <button
      type="button"
      className="empty-pile"
      aria-label={label}
      onClick={onClick}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const value = event.dataTransfer.getData('application/x-loopy-card');
        if (value && onDrop) onDrop(JSON.parse(value) as CardSource);
      }}
    ><span aria-hidden="true">{symbol ?? '♔'}</span></button>
  );
}

export function SolitaireGame() {
  const [game, setGame] = useState<GameState>(() => createGame(20260908));
  const [history, setHistory] = useState<GameState[]>([]);
  const [selected, setSelected] = useState<CardSource | null>(null);
  const [hinted, setHinted] = useState<CardSource | null>(null);
  const [message, setMessage] = useState('Build down in alternating colors. Aces go home first.');
  const [elapsed, setElapsed] = useState(0);
  const [started, setStarted] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [best, setBest] = useState<BestResult | null>(null);
  const [reaction, setReaction] = useState<Reaction>('neutral');
  const [autoFinishing, setAutoFinishing] = useState(false);
  const reactionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draggingCards = useRef<HTMLElement[]>([]);

  const react = useCallback((next: Reaction) => {
    setReaction(next);
    if (reactionTimer.current) clearTimeout(reactionTimer.current);
    if (next !== 'neutral') reactionTimer.current = setTimeout(() => setReaction('neutral'), 1200);
  }, []);

  const playSound = useCallback((kind: 'move' | 'invalid' | 'win') => {
    if (!soundOn || typeof window === 'undefined') return;
    try {
      const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = kind === 'invalid' ? 180 : kind === 'win' ? 660 : 420;
      gain.gain.setValueAtTime(0.055, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + (kind === 'win' ? 0.35 : 0.12));
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + (kind === 'win' ? 0.35 : 0.12));
      oscillator.addEventListener('ended', () => void context.close());
    } catch {
      // Audio is optional and must never block play.
    }
  }, [soundOn]);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as SavedGame | null;
        const restored = saved ? restoreGame(serializeGame(saved.game)) : null;
        if (restored && restored.status !== 'won') {
          setGame(restored);
          setElapsed(saved?.elapsed ?? 0);
          setStarted(saved?.started ?? false);
        } else setGame(createGame(Date.now()));
        const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as { soundOn?: boolean };
        setSoundOn(prefs.soundOn ?? true);
        setBest(JSON.parse(localStorage.getItem(BEST_KEY) ?? 'null') as BestResult | null);
      } catch {
        setGame(createGame(Date.now()));
      } finally {
        setHydrated(true);
      }
    });
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify({ game, elapsed, started } satisfies SavedGame));
  }, [elapsed, game, hydrated, started]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(PREFS_KEY, JSON.stringify({ soundOn }));
  }, [hydrated, soundOn]);

  useEffect(() => {
    if (!started || autoFinishing || game.status === 'won') return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [autoFinishing, game.status, started]);

  useEffect(() => () => { if (reactionTimer.current) clearTimeout(reactionTimer.current); }, []);

  const apply = useCallback((next: GameState, successMessage?: string) => {
    if (next === game) {
      setMessage('That card cannot go there yet.');
      react('surprised');
      playSound('invalid');
      return false;
    }
    setHistory((items) => [...items.slice(-49), game]);
    setGame(next);
    setSelected(null);
    setHinted(null);
    setStarted(true);
    setMessage(successMessage ?? 'Nice move!');
    react('happy');
    playSound(next.status === 'won' ? 'win' : 'move');
    if (next.status === 'won') {
      const result = { seconds: elapsed, moves: next.moves, score: next.score };
      if (!best || elapsed < best.seconds || (elapsed === best.seconds && next.score > best.score)) {
        setBest(result);
        localStorage.setItem(BEST_KEY, JSON.stringify(result));
      }
      localStorage.removeItem(STORAGE_KEY);
    }
    return true;
  }, [best, elapsed, game, playSound, react]);

  const newGame = useCallback((seed = Date.now()) => {
    setGame(createGame(seed));
    setHistory([]);
    setSelected(null);
    setHinted(null);
    setElapsed(0);
    setStarted(false);
    setAutoFinishing(false);
    setReaction('neutral');
    setMessage('A fresh deal! Build down in alternating colors.');
  }, []);

  const tryMove = useCallback((from: CardSource, to: CardTarget) => apply(moveCards(game, from, to)), [apply, game]);

  const selectOrMoveToTableau = useCallback((pile: number, index?: number) => {
    if (selected && !(selected.type === 'tableau' && selected.pile === pile)) {
      if (tryMove(selected, { type: 'tableau', pile })) return;
    }
    if (index === undefined) return setSelected(null);
    const card = game.tableau[pile][index];
    if (!card.faceUp) return;
    setSelected({ type: 'tableau', pile, index });
    setMessage(`${cardLabel(card)} selected.`);
  }, [game.tableau, selected, tryMove]);

  const handleStock = () => {
    setSelected(null);
    apply(drawFromStock(game), game.stock.length ? 'Drew a new card.' : 'The deck is ready to go around again.');
  };

  const handleWaste = () => {
    const card = game.waste.at(-1);
    if (!card) return;
    setSelected({ type: 'waste' });
    setMessage(`${cardLabel(card)} selected.`);
  };

  const sendHome = (source: CardSource) => {
    const next = autoMoveToFoundation(game, source);
    apply(next, next === game ? undefined : 'Loopy sent that card home!');
  };

  const showHint = useCallback(() => {
    const hint = findHint(game);
    if (!hint) {
      setMessage('No safe move found. Try undoing or starting a new deal.');
      react('surprised');
      return;
    }
    setHinted(hint.from);
    setSelected(hint.from.type === 'waste' && game.waste.length === 0 ? null : hint.from);
    setGame((current) => ({ ...current, score: Math.max(0, current.score - 2) }));
    setMessage(hint.message);
    react('thinking');
  }, [game, react]);

  const undo = useCallback(() => {
    const previous = history.at(-1);
    if (!previous) return;
    setGame(previous);
    setHistory((items) => items.slice(0, -1));
    setSelected(null);
    setHinted(null);
    setMessage('Move undone.');
    setStarted(previous.moves > 0);
  }, [history]);

  const toolStateRef = useRef({ game, historyLength: history.length, newGame, showHint, undo });
  useEffect(() => {
    toolStateRef.current = { game, historyLength: history.length, newGame, showHint, undo };
  }, [game, history.length, newGame, showHint, undo]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, [contenteditable="true"]')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undo();
      } else if (event.key.toLowerCase() === 'h' && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        showHint();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showHint, undo]);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = async () => {
      await context.registerTool({
        name: 'start_new_solitaire_game',
        title: 'Start a new Loopy Solitaire game',
        description: 'Replace the current deal with a freshly shuffled Loopy Solitaire game.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: (input) => {
          assertEmptyToolInput(input);
          toolStateRef.current.newGame();
          return { status: 'playing', cards: 52 };
        },
      }, { signal: lifecycle.signal });
      await context.registerTool({
        name: 'request_solitaire_hint',
        title: 'Request a solitaire hint',
        description: 'Highlight and describe a useful next move in the current game.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: (input) => {
          assertEmptyToolInput(input);
          const hint = findHint(toolStateRef.current.game);
          toolStateRef.current.showHint();
          return { available: Boolean(hint), message: hint?.message ?? 'No safe move found.' };
        },
      }, { signal: lifecycle.signal });
      await context.registerTool({
        name: 'undo_solitaire_move',
        title: 'Undo the last solitaire move',
        description: 'Restore the game to its state before the most recent move.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: (input) => {
          assertEmptyToolInput(input);
          const available = toolStateRef.current.historyLength > 0;
          toolStateRef.current.undo();
          return { undone: available };
        },
      }, { signal: lifecycle.signal });
    };
    void register().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.error('Unable to register Loopy Solitaire tools.', error);
    });
    return () => lifecycle.abort();
  }, []);

  useEffect(() => {
    if (!hydrated || autoFinishing || !isReadyForAutoFinish(game)) return;
    const timer = window.setTimeout(() => {
      setSelected(null);
      setHinted(null);
      setMessage('Loopy is sorting the last cards…');
      setReaction('happy');
      setAutoFinishing(true);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [autoFinishing, game, hydrated]);

  useEffect(() => {
    if (!autoFinishing) return;
    if (game.status === 'won') return;

    const move = findAutoFoundationMove(game);
    if (!move) {
      const stopTimer = window.setTimeout(() => {
        setAutoFinishing(false);
        setMessage('Choose the next move and Loopy will keep sorting.');
      }, 0);
      return () => window.clearTimeout(stopTimer);
    }

    let finished = false;
    let flight: HTMLElement | null = null;
    let animationFrame = 0;
    let fallbackTimer = 0;
    const startTimer = window.setTimeout(() => {
      const next = moveCards(game, move.from, move.to);
      const source = document.querySelector<HTMLElement>(`[data-card-id="${move.card.id}"]`);
      const target = document.querySelector<HTMLElement>(`[data-foundation-suit="${move.card.suit}"]`);
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      const complete = () => {
        if (finished) return;
        finished = true;
        source?.classList.remove('is-auto-moving');
        flight?.remove();
        apply(next, next.status === 'won' ? 'You win! Loopy sorted every card!' : 'Loopy is sorting the last cards…');
      };

      if (!source || !target || reduceMotion) {
        fallbackTimer = window.setTimeout(complete, reduceMotion ? 35 : 0);
        return;
      }

      const from = source.getBoundingClientRect();
      const to = target.getBoundingClientRect();
      flight = source.cloneNode(true) as HTMLElement;
      flight.classList.add('auto-finish-flying-card');
      flight.setAttribute('aria-hidden', 'true');
      Object.assign(flight.style, {
        left: `${from.left}px`,
        top: `${from.top}px`,
        width: `${from.width}px`,
        height: `${from.height}px`,
      });
      source.classList.add('is-auto-moving');
      document.body.appendChild(flight);
      animationFrame = requestAnimationFrame(() => {
        if (!flight) return;
        flight.style.transform = `translate(${to.left - from.left}px, ${to.top - from.top}px) rotate(${move.card.suit === 'hearts' || move.card.suit === 'clubs' ? 2 : -2}deg) scale(.96)`;
      });
      flight.addEventListener('transitionend', complete, { once: true });
      fallbackTimer = window.setTimeout(complete, 260);
    }, 55);

    return () => {
      window.clearTimeout(startTimer);
      window.clearTimeout(fallbackTimer);
      cancelAnimationFrame(animationFrame);
      if (!finished) {
        document.querySelector<HTMLElement>(`[data-card-id="${move.card.id}"]`)?.classList.remove('is-auto-moving');
        flight?.remove();
      }
    };
  }, [apply, autoFinishing, game]);

  const clearDragVisuals = () => {
    draggingCards.current.forEach((card) => card.classList.remove('is-dragging'));
    draggingCards.current = [];
  };

  const dragSource = (event: React.DragEvent<HTMLButtonElement>, source: CardSource) => {
    clearDragVisuals();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-loopy-card', JSON.stringify(source));

    if (source.type !== 'tableau') return;
    const sourceCard = event.currentTarget.closest<HTMLElement>('.tableau-card');
    const pile = sourceCard?.parentElement;
    if (!sourceCard || !pile) return;

    const cards = Array.from(pile.querySelectorAll<HTMLElement>(':scope > .tableau-card')).slice(source.index);
    if (cards.length < 2) return;

    const preview = document.createElement('div');
    const sourceRect = sourceCard.getBoundingClientRect();
    const lastCard = cards.at(-1)!;
    preview.className = 'drag-stack-preview';
    preview.setAttribute('aria-hidden', 'true');
    preview.style.width = `${sourceRect.width}px`;
    preview.style.height = `${lastCard.offsetTop - sourceCard.offsetTop + lastCard.offsetHeight}px`;

    cards.forEach((card) => {
      const clone = card.cloneNode(true) as HTMLElement;
      clone.classList.remove('is-dragging');
      clone.style.top = `${card.offsetTop - sourceCard.offsetTop}px`;
      clone.style.left = '0';
      clone.style.opacity = '1';
      preview.appendChild(clone);
      card.classList.add('is-dragging');
    });

    document.body.appendChild(preview);
    draggingCards.current = cards;
    const pointerX = Math.max(0, Math.min(sourceRect.width, event.clientX - sourceRect.left));
    const pointerY = Math.max(0, Math.min(sourceRect.height, event.clientY - sourceRect.top));
    event.dataTransfer.setDragImage(preview, pointerX, pointerY);
    requestAnimationFrame(() => preview.remove());
  };

  const dropOn = (event: React.DragEvent, target: CardTarget) => {
    event.preventDefault();
    const value = event.dataTransfer.getData('application/x-loopy-card');
    if (value) tryMove(JSON.parse(value) as CardSource, target);
  };

  const reactionSrc = reaction === 'surprised' ? '/loopy/surprised.webp' : reaction === 'thinking' ? '/loopy/developer.png' : reaction === 'happy' ? '/loopy/student.png' : '/loopy/neutral.png';
  const selectedKey = sourceKey(selected);
  const hintedKey = sourceKey(hinted);
  const foundationCount = useMemo(() => SUITS.reduce((total, suit) => total + game.foundations[suit].length, 0), [game.foundations]);

  return (
    <main className="solitaire-page">
      <div className="cloud cloud-one" aria-hidden="true" /><div className="cloud cloud-two" aria-hidden="true" /><div className="flower-field" aria-hidden="true" />
      <section className="game-wrap" aria-labelledby="game-title">
        <header className="app-header">
          <div className="brand-block"><h1 id="game-title">Loopy Solitaire</h1><p>Take it easy. Loopy has the cards.</p></div>
          <div className="status-bar" aria-label="Game status">
            <span><small>Time</small><strong>{formatTime(elapsed)}</strong></span>
            <span><small>Moves</small><strong>{String(game.moves).padStart(3, '0')}</strong></span>
            <span><small>Score</small><strong>{String(game.score).padStart(3, '0')}</strong></span>
          </div>
          <nav className="game-actions" aria-label="Game controls">
            <button type="button" className="icon-action" onClick={undo} disabled={autoFinishing || !history.length} aria-label="Undo last move"><Undo2 /></button>
            <button type="button" className="icon-action" onClick={showHint} disabled={autoFinishing} aria-label="Show a hint"><Lightbulb /></button>
            <button type="button" className="icon-action" onClick={() => setSoundOn((value) => !value)} aria-label={soundOn ? 'Turn sound off' : 'Turn sound on'}>{soundOn ? <Music2 /> : <Music />}</button>
            <AlertDialog>
              <AlertDialogTrigger render={<button type="button" className="new-game-button" aria-label="Start a new game" disabled={autoFinishing} />}><Sparkles /> New game</AlertDialogTrigger>
              <AlertDialogContent className="loopy-confirm">
                <AlertDialogHeader><AlertDialogTitle>Shuffle a fresh deal?</AlertDialogTitle><AlertDialogDescription>Your current game will be replaced with a brand-new one.</AlertDialogDescription></AlertDialogHeader>
                <AlertDialogFooter><AlertDialogCancel>Keep playing</AlertDialogCancel><AlertDialogAction onClick={() => newGame()}>New deal</AlertDialogAction></AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </nav>
        </header>

        <section className={`game-table ${autoFinishing ? 'is-auto-finishing' : ''}`} aria-label="Klondike solitaire table" aria-busy={!hydrated || autoFinishing}>
          {autoFinishing ? <output className="auto-finish-banner" aria-live="polite"><Sparkles aria-hidden="true" /> Loopy is sorting the last {52 - foundationCount} cards!</output> : null}
          <div className="table-top-row">
            <div className="pile-group stock-group">
              <div className="pile-slot">
                {game.stock.length ? <CardView card={{ ...game.stock.at(-1)!, faceUp: false }} onClick={handleStock} /> : <EmptyPile label={game.waste.length ? 'Recycle waste into stock' : 'Empty stock'} symbol="↻" onClick={handleStock} />}
                <span className="pile-label">Stock</span>
              </div>
              <div className="pile-slot">
                {game.waste.length ? <CardView card={game.waste.at(-1)!} selected={selectedKey === 'waste'} hinted={hintedKey === 'waste'} onClick={handleWaste} onDoubleClick={() => sendHome({ type: 'waste' })} onDragStart={(event) => dragSource(event, { type: 'waste' })} /> : <EmptyPile label="Empty waste pile" symbol="♡" />}
                <span className="pile-label">Waste</span>
              </div>
            </div>

            <button type="button" className={`loopy-reaction reaction-${reaction}`} onClick={() => newGame(game.seed)} aria-label="Restart this deal"><Image src={reactionSrc} alt="" width={220} height={220} /></button>

            <div className="pile-group foundations" aria-label="Foundations">
              {SUITS.map((suit) => {
                const pile = game.foundations[suit];
                const card = pile.at(-1);
                const source: CardSource = { type: 'foundation', suit };
                return (
                  <div className="pile-slot" data-foundation-suit={suit} key={suit} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropOn(event, { type: 'foundation', suit })}>
                    {card ? <CardView card={card} selected={selectedKey === sourceKey(source)} hinted={hintedKey === sourceKey(source)} onClick={() => selected ? tryMove(selected, { type: 'foundation', suit }) : setSelected(source)} onDragStart={(event) => dragSource(event, source)} /> : <EmptyPile label={`Empty ${suit} foundation`} symbol={suitSymbol(suit)} onClick={() => selected && tryMove(selected, { type: 'foundation', suit })} onDrop={(from) => tryMove(from, { type: 'foundation', suit })} />}
                    <span className="pile-label">{suit.slice(0, 1).toUpperCase()}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="tableau" aria-label="Tableau">
            {game.tableau.map((pile, pileIndex) => (
              <div className="tableau-pile" key={pileIndex} style={{ '--pile-length': Math.max(pile.length, 1) } as React.CSSProperties} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropOn(event, { type: 'tableau', pile: pileIndex })}>
                {!pile.length && <EmptyPile label={`Empty tableau column ${pileIndex + 1}`} onClick={() => selectOrMoveToTableau(pileIndex)} onDrop={(from) => tryMove(from, { type: 'tableau', pile: pileIndex })} />}
                {pile.map((card, index) => {
                  const source: CardSource = { type: 'tableau', pile: pileIndex, index };
                  const key = sourceKey(source);
                  return <div className={`tableau-card ${card.faceUp ? 'face-up' : 'face-down'}`} style={{ '--card-index': index, '--face-index': pile.slice(0, index).filter((item) => item.faceUp).length } as React.CSSProperties} key={card.id}>
                    <CardView card={card} selected={selectedKey === key} hinted={hintedKey === key} onClick={() => selectOrMoveToTableau(pileIndex, index)} onDoubleClick={() => card.faceUp && sendHome(source)} onDragStart={card.faceUp ? (event) => dragSource(event, source) : undefined} onDragEnd={clearDragVisuals} />
                  </div>;
                })}
              </div>
            ))}
          </div>
        </section>

        <footer className="game-footer">
          <output aria-live="polite"><HelpCircle aria-hidden="true" /> {message}</output>
          <p><strong>{foundationCount}/52</strong> cards home {best ? <span>• Best {formatTime(best.seconds)}</span> : null}</p>
        </footer>
      </section>

      <Dialog open={game.status === 'won'}>
        <DialogContent className="win-dialog" showCloseButton={false}>
          <DialogHeader><Image src="/loopy/student.png" alt="Celebrating Loopy" width={600} height={600} /><span className="win-kicker"><Trophy /> Game complete</span><DialogTitle>You win!</DialogTitle><DialogDescription>Loopy sorted every card home.<br />{formatTime(elapsed)} · {game.moves} moves · {game.score} points</DialogDescription></DialogHeader>
          <DialogFooter><button type="button" className="play-again-button" onClick={() => newGame()}><Play /> Play again</button></DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
