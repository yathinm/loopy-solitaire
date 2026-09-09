import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canPlaceOnFoundation,
  canPlaceOnTableau,
  createDeck,
  createGame,
  drawFromStock,
  isValidTableauSequence,
  moveCards,
  restoreGame,
  serializeGame,
  type Card,
} from './solitaire.ts';

const card = (id: string, rank: Card['rank'], suit: Card['suit'], faceUp = true): Card => ({ id, rank, suit, faceUp });

void test('creates a complete unique deck', () => {
  const deck = createDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map((item) => item.id)).size, 52);
});

void test('deals seven valid tableau piles and 24 stock cards', () => {
  const game = createGame(1234);
  assert.deepEqual(game.tableau.map((pile) => pile.length), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(game.stock.length, 24);
  game.tableau.forEach((pile) => {
    assert.equal(pile.filter((item) => item.faceUp).length, 1);
    assert.equal(pile.at(-1)?.faceUp, true);
  });
});

void test('seeded deals are repeatable', () => {
  assert.deepEqual(createGame(42), createGame(42));
  assert.notDeepEqual(createGame(42).stock, createGame(43).stock);
});

void test('validates alternating descending tableau placement', () => {
  assert.equal(canPlaceOnTableau(card('a', 12, 'hearts'), [card('b', 13, 'clubs')]), true);
  assert.equal(canPlaceOnTableau(card('a', 12, 'diamonds'), [card('b', 13, 'hearts')]), false);
  assert.equal(canPlaceOnTableau(card('k', 13, 'spades'), []), true);
  assert.equal(canPlaceOnTableau(card('q', 12, 'spades'), []), false);
  assert.equal(isValidTableauSequence([card('k', 13, 'spades'), card('q', 12, 'hearts')]), true);
});

void test('validates foundations by ascending suit', () => {
  assert.equal(canPlaceOnFoundation(card('a', 1, 'hearts'), [], 'hearts'), true);
  assert.equal(canPlaceOnFoundation(card('two', 2, 'hearts'), [card('a', 1, 'hearts')], 'hearts'), true);
  assert.equal(canPlaceOnFoundation(card('two', 2, 'diamonds'), [card('a', 1, 'hearts')], 'hearts'), false);
});

void test('draws and recycles stock in stable order', () => {
  let game = createGame(99);
  const first = game.stock.at(-1)?.id;
  for (let index = 0; index < 24; index += 1) game = drawFromStock(game);
  assert.equal(game.stock.length, 0);
  assert.equal(game.waste.length, 24);
  game = drawFromStock(game);
  assert.equal(game.stock.length, 24);
  assert.equal(game.waste.length, 0);
  game = drawFromStock(game);
  assert.equal(game.waste.at(-1)?.id, first);
});

void test('moves an exposed ace to its foundation and reveals covered cards', () => {
  const game = createGame(5);
  game.tableau = [[card('hidden', 2, 'clubs', false), card('ace', 1, 'hearts')], [], [], [], [], [], []];
  game.stock = createDeck().filter((item) => item.id !== 'hearts-1' && item.id !== 'clubs-2');
  const moved = moveCards(game, { type: 'tableau', pile: 0, index: 1 }, { type: 'foundation', suit: 'hearts' });
  assert.equal(moved.foundations.hearts.at(-1)?.id, 'ace');
  assert.equal(moved.tableau[0].at(-1)?.faceUp, true);
  assert.equal(moved.score, 15);
});

void test('moves a valid tableau sequence and leaves invalid moves unchanged', () => {
  const game = createGame(77);
  game.tableau = [
    [card('king-black', 13, 'clubs')],
    [card('queen-red', 12, 'hearts'), card('jack-black', 11, 'spades')],
    [card('queen-same-color', 12, 'diamonds')],
    [], [], [], [],
  ];
  game.stock = createDeck().slice(0, 48);
  const moved = moveCards(game, { type: 'tableau', pile: 1, index: 0 }, { type: 'tableau', pile: 0 });
  assert.deepEqual(moved.tableau[0].map((item) => item.id), ['king-black', 'queen-red', 'jack-black']);
  assert.equal(moved.tableau[1].length, 0);
  const invalid = moveCards(game, { type: 'tableau', pile: 2, index: 0 }, { type: 'tableau', pile: 1 });
  assert.equal(invalid, game);
});

void test('allows a foundation card back onto the tableau with a score penalty', () => {
  const game = createGame(88);
  game.foundations.hearts = [card('ace-hearts', 1, 'hearts')];
  game.tableau[0] = [card('two-clubs', 2, 'clubs')];
  game.score = 20;
  const moved = moveCards(game, { type: 'foundation', suit: 'hearts' }, { type: 'tableau', pile: 0 });
  assert.equal(moved.tableau[0].at(-1)?.id, 'ace-hearts');
  assert.equal(moved.score, 10);
});

void test('recognizes a completed game', () => {
  const game = createGame(101);
  const deck = createDeck().map((item) => ({ ...item, faceUp: true }));
  game.stock = [];
  game.waste = [];
  game.tableau = [[deck.find((item) => item.id === 'hearts-13')!], [], [], [], [], [], []];
  for (const suit of ['hearts', 'diamonds', 'clubs', 'spades'] as const) {
    game.foundations[suit] = deck.filter((item) => item.suit === suit && !(suit === 'hearts' && item.rank === 13));
  }
  const won = moveCards(game, { type: 'tableau', pile: 0, index: 0 }, { type: 'foundation', suit: 'hearts' });
  assert.equal(won.status, 'won');
});

void test('round trips valid saved games and rejects malformed data', () => {
  const game = createGame(2026);
  assert.deepEqual(restoreGame(serializeGame(game)), game);
  assert.equal(restoreGame('{"tableau":[]}'), null);
  assert.equal(restoreGame('not-json'), null);
});
