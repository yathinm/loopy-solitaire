export const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'] as const;
export type Suit = (typeof SUITS)[number];
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

export type Card = {
  id: string;
  suit: Suit;
  rank: Rank;
  faceUp: boolean;
};

export type GameStatus = 'playing' | 'won';

export type GameState = {
  tableau: Card[][];
  foundations: Record<Suit, Card[]>;
  stock: Card[];
  waste: Card[];
  moves: number;
  score: number;
  status: GameStatus;
  seed: number;
};

export type CardSource =
  | { type: 'tableau'; pile: number; index: number }
  | { type: 'waste' }
  | { type: 'foundation'; suit: Suit };

export type CardTarget =
  | { type: 'tableau'; pile: number }
  | { type: 'foundation'; suit: Suit };

export type Hint = { from: CardSource; to: CardTarget; message: string };
export type FoundationMove = {
  from: CardSource;
  to: Extract<CardTarget, { type: 'foundation' }>;
  card: Card;
};

const isRed = (suit: Suit) => suit === 'hearts' || suit === 'diamonds';

export function rankLabel(rank: Rank): string {
  return ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' } as Partial<Record<Rank, string>>)[rank] ?? String(rank);
}

export function suitSymbol(suit: Suit): string {
  return { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }[suit];
}

export function cardLabel(card: Card): string {
  const names: Record<Rank, string> = {
    1: 'Ace', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7',
    8: '8', 9: '9', 10: '10', 11: 'Jack', 12: 'Queen', 13: 'King',
  };
  return `${names[card.rank]} of ${card.suit}`;
}

export function createDeck(): Card[] {
  return SUITS.flatMap((suit) =>
    Array.from({ length: 13 }, (_, index) => {
      const rank = (index + 1) as Rank;
      return { id: `${suit}-${rank}`, suit, rank, faceUp: false };
    }),
  );
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleDeck(deck: Card[], seed: number): Card[] {
  const shuffled = deck.map((card) => ({ ...card }));
  const random = seededRandom(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function createGame(seed = Date.now()): GameState {
  const deck = shuffleDeck(createDeck(), seed);
  const tableau: Card[][] = Array.from({ length: 7 }, () => []);

  for (let column = 0; column < 7; column += 1) {
    for (let row = 0; row <= column; row += 1) {
      const card = deck.pop();
      if (!card) throw new Error('Deck exhausted while dealing.');
      tableau[column].push({ ...card, faceUp: row === column });
    }
  }

  return {
    tableau,
    foundations: { hearts: [], diamonds: [], clubs: [], spades: [] },
    stock: deck,
    waste: [],
    moves: 0,
    score: 0,
    status: 'playing',
    seed,
  };
}

export function isValidTableauSequence(cards: Card[]): boolean {
  return cards.every((card, index) => {
    if (!card.faceUp) return false;
    if (index === cards.length - 1) return true;
    const next = cards[index + 1];
    return card.rank === next.rank + 1 && isRed(card.suit) !== isRed(next.suit);
  });
}

export function canPlaceOnTableau(card: Card, target: Card[]): boolean {
  const top = target.at(-1);
  if (!top) return card.rank === 13;
  return top.faceUp && top.rank === card.rank + 1 && isRed(top.suit) !== isRed(card.suit);
}

export function canPlaceOnFoundation(card: Card, target: Card[], suit: Suit): boolean {
  if (card.suit !== suit) return false;
  const top = target.at(-1);
  return top ? card.rank === top.rank + 1 : card.rank === 1;
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    tableau: state.tableau.map((pile) => pile.map((card) => ({ ...card }))),
    foundations: Object.fromEntries(
      SUITS.map((suit) => [suit, state.foundations[suit].map((card) => ({ ...card }))]),
    ) as Record<Suit, Card[]>,
    stock: state.stock.map((card) => ({ ...card })),
    waste: state.waste.map((card) => ({ ...card })),
  };
}

function finishMove(state: GameState, scoreDelta: number): GameState {
  state.moves += 1;
  state.score = Math.max(0, state.score + scoreDelta);
  if (SUITS.reduce((total, suit) => total + state.foundations[suit].length, 0) === 52) {
    state.status = 'won';
  }
  return state;
}

export function drawFromStock(state: GameState): GameState {
  if (state.status === 'won') return state;
  const next = cloneState(state);
  if (next.stock.length > 0) {
    const card = next.stock.pop();
    if (!card) return state;
    next.waste.push({ ...card, faceUp: true });
  } else if (next.waste.length > 0) {
    next.stock = next.waste.reverse().map((card) => ({ ...card, faceUp: false }));
    next.waste = [];
  } else {
    return state;
  }
  return finishMove(next, 0);
}

function cardsFromSource(state: GameState, source: CardSource): Card[] | null {
  if (source.type === 'waste') {
    const card = state.waste.at(-1);
    return card ? [card] : null;
  }
  if (source.type === 'foundation') {
    const card = state.foundations[source.suit].at(-1);
    return card ? [card] : null;
  }
  const pile = state.tableau[source.pile];
  if (!pile || source.index < 0 || source.index >= pile.length) return null;
  const cards = pile.slice(source.index);
  return isValidTableauSequence(cards) ? cards : null;
}

function removeFromSource(state: GameState, source: CardSource): Card[] {
  if (source.type === 'waste') return [state.waste.pop()!];
  if (source.type === 'foundation') return [state.foundations[source.suit].pop()!];
  return state.tableau[source.pile].splice(source.index);
}

export function moveCards(state: GameState, source: CardSource, target: CardTarget): GameState {
  if (state.status === 'won') return state;
  if (source.type === 'tableau' && target.type === 'tableau' && source.pile === target.pile) return state;
  if (source.type === 'foundation' && target.type === 'foundation') return state;

  const cards = cardsFromSource(state, source);
  if (!cards?.length) return state;
  const lead = cards[0];

  if (target.type === 'foundation') {
    if (cards.length !== 1 || !canPlaceOnFoundation(lead, state.foundations[target.suit], target.suit)) return state;
  } else if (!canPlaceOnTableau(lead, state.tableau[target.pile] ?? [])) {
    return state;
  }

  const next = cloneState(state);
  const moved = removeFromSource(next, source).map((card) => ({ ...card, faceUp: true }));
  let scoreDelta = 0;

  if (target.type === 'foundation') {
    next.foundations[target.suit].push(...moved);
    scoreDelta += 10;
  } else {
    next.tableau[target.pile].push(...moved);
    if (source.type === 'waste') scoreDelta += 5;
    if (source.type === 'foundation') scoreDelta -= 10;
  }

  if (source.type === 'tableau') {
    const exposed = next.tableau[source.pile].at(-1);
    if (exposed && !exposed.faceUp) {
      exposed.faceUp = true;
      scoreDelta += 5;
    }
  }

  return finishMove(next, scoreDelta);
}

export function findHint(state: GameState): Hint | null {
  const candidates: CardSource[] = [];
  if (state.waste.length) candidates.push({ type: 'waste' });
  state.tableau.forEach((pile, pileIndex) => {
    pile.forEach((card, index) => {
      if (card.faceUp && isValidTableauSequence(pile.slice(index))) {
        candidates.push({ type: 'tableau', pile: pileIndex, index });
      }
    });
  });

  for (const from of candidates) {
    const cards = cardsFromSource(state, from);
    if (!cards) continue;
    const card = cards[0];
    if (cards.length === 1 && canPlaceOnFoundation(card, state.foundations[card.suit], card.suit)) {
      return { from, to: { type: 'foundation', suit: card.suit }, message: `Move ${cardLabel(card)} to its foundation.` };
    }
  }

  for (const from of candidates) {
    const cards = cardsFromSource(state, from);
    if (!cards) continue;
    const card = cards[0];
    for (let pile = 0; pile < state.tableau.length; pile += 1) {
      if (from.type === 'tableau' && from.pile === pile) continue;
      if (canPlaceOnTableau(card, state.tableau[pile])) {
        return { from, to: { type: 'tableau', pile }, message: `Move ${cardLabel(card)} to tableau column ${pile + 1}.` };
      }
    }
  }

  if (state.stock.length || state.waste.length) {
    return { from: { type: 'waste' }, to: { type: 'tableau', pile: 0 }, message: state.stock.length ? 'Draw a card from the stock.' : 'Recycle the waste pile.' };
  }
  return null;
}

export function autoMoveToFoundation(state: GameState, source: CardSource): GameState {
  const cards = cardsFromSource(state, source);
  if (!cards || cards.length !== 1) return state;
  return moveCards(state, source, { type: 'foundation', suit: cards[0].suit });
}

export function findAutoFoundationMove(state: GameState): FoundationMove | null {
  if (state.status === 'won') return null;
  const sources: CardSource[] = [];
  if (state.waste.length) sources.push({ type: 'waste' });
  state.tableau.forEach((pile, pileIndex) => {
    if (pile.length) sources.push({ type: 'tableau', pile: pileIndex, index: pile.length - 1 });
  });

  for (const from of sources) {
    const cards = cardsFromSource(state, from);
    if (!cards || cards.length !== 1) continue;
    const card = cards[0];
    if (canPlaceOnFoundation(card, state.foundations[card.suit], card.suit)) {
      return { from, to: { type: 'foundation', suit: card.suit }, card };
    }
  }
  return null;
}

export function isReadyForAutoFinish(state: GameState): boolean {
  if (state.status === 'won' || state.stock.length || state.waste.length) return false;
  const remaining = state.tableau.flat();
  return remaining.length > 0 && remaining.every((card) => card.faceUp) && findAutoFoundationMove(state) !== null;
}

export function serializeGame(state: GameState): string {
  return JSON.stringify(state);
}

export function restoreGame(value: string | null): GameState | null {
  if (!value) return null;
  try {
    const state = JSON.parse(value) as GameState;
    const cards = [
      ...state.stock,
      ...state.waste,
      ...state.tableau.flat(),
      ...SUITS.flatMap((suit) => state.foundations[suit]),
    ];
    if (cards.length !== 52 || new Set(cards.map((card) => card.id)).size !== 52) return null;
    if (state.tableau.length !== 7 || !Number.isFinite(state.moves) || !Number.isFinite(state.score)) return null;
    return state;
  } catch {
    return null;
  }
}
