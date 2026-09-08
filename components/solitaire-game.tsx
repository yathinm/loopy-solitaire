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
  findHint,
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

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function CardView({ card, selected, hinted, className = '', onClick, onDoubleClick, onDragStart }: {
  card: Card;
  selected?: boolean;
  hinted?: boolean;
  className?: string;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onDragStart?: (event: React.DragEvent<HTMLButtonElement>) => void;
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
      draggable
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onDragStart={onDragStart}
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
  const reactionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (!started || game.status === 'won') return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [game.status, started]);

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

  const showHint = () => {
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
  };

  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setGame(previous);
    setHistory((items) => items.slice(0, -1));
    setSelected(null);
    setHinted(null);
    setMessage('Move undone.');
    setStarted(previous.moves > 0);
  };

  const dragSource = (event: React.DragEvent<HTMLButtonElement>, source: CardSource) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-loopy-card', JSON.stringify(source));
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
            <button type="button" className="icon-action" onClick={undo} disabled={!history.length} aria-label="Undo last move"><Undo2 /></button>
            <button type="button" className="icon-action" onClick={showHint} aria-label="Show a hint"><Lightbulb /></button>
            <button type="button" className="icon-action" onClick={() => setSoundOn((value) => !value)} aria-label={soundOn ? 'Turn sound off' : 'Turn sound on'}>{soundOn ? <Music2 /> : <Music />}</button>
            <AlertDialog>
              <AlertDialogTrigger render={<button type="button" className="new-game-button" aria-label="Start a new game" />}><Sparkles /> New game</AlertDialogTrigger>
              <AlertDialogContent className="loopy-confirm">
                <AlertDialogHeader><AlertDialogTitle>Shuffle a fresh deal?</AlertDialogTitle><AlertDialogDescription>Your current game will be replaced with a brand-new one.</AlertDialogDescription></AlertDialogHeader>
                <AlertDialogFooter><AlertDialogCancel>Keep playing</AlertDialogCancel><AlertDialogAction onClick={() => newGame()}>New deal</AlertDialogAction></AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </nav>
        </header>

        <section className="game-table" aria-label="Klondike solitaire table" aria-busy={!hydrated}>
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
                  <div className="pile-slot" key={suit} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropOn(event, { type: 'foundation', suit })}>
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
                    <CardView card={card} selected={selectedKey === key} hinted={hintedKey === key} onClick={() => selectOrMoveToTableau(pileIndex, index)} onDoubleClick={() => card.faceUp && sendHome(source)} onDragStart={card.faceUp ? (event) => dragSource(event, source) : undefined} />
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
          <DialogHeader><Image src="/loopy/student.png" alt="Celebrating Loopy" width={600} height={600} /><span className="win-kicker"><Trophy /> You did it!</span><DialogTitle>Loopy cleared the table</DialogTitle><DialogDescription>{formatTime(elapsed)} · {game.moves} moves · {game.score} points</DialogDescription></DialogHeader>
          <DialogFooter><button type="button" className="play-again-button" onClick={() => newGame()}><Play /> Play again</button></DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
