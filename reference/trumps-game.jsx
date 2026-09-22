import { useState } from "react";

const SUITS = ["S", "H", "C", "D"];
const SUIT_SYMBOL = { S: "♠", H: "♥", D: "♦", C: "♣" };
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const RANK_VALUE = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));
const HAND_SIZES = [
  ...Array.from({ length: 11 }, (_, i) => 12 - i),
  ...Array.from({ length: 11 }, (_, i) => i + 2),
];
const DEFAULT_NAMES = ["Player 1", "Player 2", "Player 3", "Player 4"];

function buildDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ suit: s, rank: r, value: RANK_VALUE[r] });
  return deck;
}

function shuffle(deck) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function sortHand(hand) {
  return [...hand].sort((a, b) => {
    if (a.suit !== b.suit) return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
    return a.value - b.value;
  });
}

function dealHand(dealerIndex, handIndex, totals, history) {
  const size = HAND_SIZES[handIndex];
  const deck = shuffle(buildDeck());
  const hands = [[], [], [], []];
  let idx = 0;
  for (let c = 0; c < size; c++) {
    for (let p = 0; p < 4; p++) {
      hands[p].push(deck[idx]);
      idx++;
    }
  }
  const sortedHands = hands.map(sortHand);
  const stock = deck.slice(idx);
  const trumpCard = stock[0];
  const bidOrder = [0, 1, 2, 3].map((i) => (dealerIndex + i) % 4);

  return {
    handIndex,
    handSize: size,
    dealerIndex,
    trumpCard,
    trumpSuit: trumpCard.suit,
    hands: sortedHands,
    bids: [null, null, null, null],
    tricksWon: [0, 0, 0, 0],
    totals,
    history,
    phase: "bidding",
    bidOrder,
    bidTurnPos: 0,
    trickNumber: 0,
    currentTrick: { leaderIndex: dealerIndex, plays: [], ledSuit: null },
    lastTrick: null,
  };
}

function scoreFor(bid, won) {
  if (won === bid) return bid * 10;
  if (won > bid) return bid * 10 + (won - bid);
  return bid * -10;
}

function isCardLegal(game, playerIndex, card) {
  const hand = game.hands[playerIndex];
  if (game.trickNumber === 0) {
    const hasTrump = hand.some((c) => c.suit === game.trumpSuit);
    return !hasTrump || card.suit === game.trumpSuit;
  }
  if (game.currentTrick.plays.length === 0) return true;
  const ledSuit = game.currentTrick.ledSuit;
  const hasLed = hand.some((c) => c.suit === ledSuit);
  return !hasLed || card.suit === ledSuit;
}

function resolveTrickWinner(plays, trumpSuit) {
  const trumpPlays = plays.filter((p) => p.card.suit === trumpSuit);
  const pool = trumpPlays.length > 0 ? trumpPlays : plays.filter((p) => p.card.suit === plays[0].card.suit);
  return pool.reduce((best, p) => (p.card.value > best.card.value ? p : best), pool[0]).playerIndex;
}

function Card({ card, onClick, disabled, small, selected }) {
  const red = card.suit === "H" || card.suit === "D";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ borderRadius: "8px" }}
      className={
        (small ? "w-10 h-14 text-sm " : "w-12 h-16 text-base ") +
        "flex flex-col items-center justify-center border font-medium shrink-0 " +
        (red ? "text-red-600 " : "text-gray-900 ") +
        (disabled
          ? "bg-gray-50 border-gray-200 opacity-40 cursor-not-allowed"
          : selected
          ? "bg-amber-100 border-gray-900 border-2 cursor-pointer active:scale-95"
          : "bg-white border-gray-300 hover:border-gray-500 cursor-pointer active:scale-95")
      }
    >
      <span>{card.rank}</span>
      <span className="text-lg leading-none">{SUIT_SYMBOL[card.suit]}</span>
    </button>
  );
}

function Scoreboard({ game, names }) {
  return (
    <div className="grid grid-cols-4 gap-2 mb-3">
      {names.map((name, i) => (
        <div key={i} className="bg-gray-100 rounded-lg px-2 py-1.5 text-center">
          <div className="text-[11px] text-gray-500 truncate">{name}</div>
          <div className="text-base font-medium">{game.totals[i]}</div>
        </div>
      ))}
    </div>
  );
}

function TallyTab({ game, names }) {
  return (
    <div>
      <div className="overflow-x-auto -mx-3 px-3">
        <table className="text-[11px] border-collapse">
          <thead>
            <tr>
              <th className="px-1.5 py-1 text-left text-gray-500 font-medium sticky left-0 bg-white">Hand</th>
              {names.map((name, i) => (
                <th
                  key={i}
                  colSpan={3}
                  className={"px-1.5 py-1 text-center font-medium " + (i > 0 ? "border-l border-gray-300" : "")}
                >
                  {name}
                </th>
              ))}
            </tr>
            <tr className="text-gray-500">
              <th className="px-1.5 py-1 sticky left-0 bg-white"></th>
              {names.map((_, i) => (
                <>
                  <th key={"b" + i} className={"px-1.5 py-1 font-normal " + (i > 0 ? "border-l border-gray-300" : "")}>
                    Bid
                  </th>
                  <th key={"w" + i} className="px-1.5 py-1 font-normal">
                    Win
                  </th>
                  <th key={"s" + i} className="px-1.5 py-1 font-normal">
                    Score
                  </th>
                </>
              ))}
            </tr>
          </thead>
          <tbody>
            {game.history.length === 0 && (
              <tr>
                <td colSpan={13} className="px-1.5 py-3 text-center text-gray-400">
                  No hands completed yet
                </td>
              </tr>
            )}
            {game.history.map((h) => (
              <tr key={h.handIndex} className="border-t border-gray-200">
                <td className="px-1.5 py-1 text-gray-500 sticky left-0 bg-white">{h.handSize}</td>
                {[0, 1, 2, 3].map((i) => (
                  <>
                    <td key={"b" + i} className={"px-1.5 py-1 text-center " + (i > 0 ? "border-l border-gray-300" : "")}>
                      {h.bids[i]}
                    </td>
                    <td key={"w" + i} className="px-1.5 py-1 text-center">
                      {h.won[i]}
                    </td>
                    <td
                      key={"s" + i}
                      className={"px-1.5 py-1 text-center " + (h.scores[i] >= 0 ? "text-emerald-700" : "text-red-600")}
                    >
                      {h.scores[i] >= 0 ? `+${h.scores[i]}` : h.scores[i]}
                    </td>
                  </>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-400 font-medium">
              <td className="px-1.5 py-1 sticky left-0 bg-white">Total</td>
              {[0, 1, 2, 3].map((i) => (
                <td key={i} colSpan={3} className={"px-1.5 py-1 text-center " + (i > 0 ? "border-l border-gray-300" : "")}>
                  {game.totals[i]}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

export default function TrumpsGame() {
  const [game, setGame] = useState(() => dealHand(0, 0, [0, 0, 0, 0], []));
  const [pendingBid, setPendingBid] = useState(null);
  const [pendingCard, setPendingCard] = useState(null);
  const [names, setNames] = useState(DEFAULT_NAMES);
  const [tab, setTab] = useState("game");

  function newGame() {
    setGame(dealHand(0, 0, [0, 0, 0, 0], []));
    setPendingBid(null);
    setPendingCard(null);
    setTab("game");
  }

  function updateName(i, value) {
    const next = [...names];
    next[i] = value;
    setNames(next);
  }

  function confirmBid() {
    if (pendingBid === null) return;
    const playerIndex = game.bidOrder[game.bidTurnPos];
    const bids = [...game.bids];
    bids[playerIndex] = pendingBid;
    const bidTurnPos = game.bidTurnPos + 1;
    setGame({
      ...game,
      bids,
      bidTurnPos,
      phase: bidTurnPos === 4 ? "playing" : "bidding",
    });
    setPendingBid(null);
  }

  function selectCard(playerIndex, cardIndex) {
    const turnPlayer = (game.currentTrick.leaderIndex + game.currentTrick.plays.length) % 4;
    if (turnPlayer !== playerIndex) return;
    const card = game.hands[playerIndex][cardIndex];
    if (!isCardLegal(game, playerIndex, card)) return;
    setPendingCard({ playerIndex, cardIndex });
  }

  function confirmPlay() {
    if (!pendingCard) return;
    const { playerIndex, cardIndex } = pendingCard;
    const card = game.hands[playerIndex][cardIndex];

    const hands = game.hands.map((h, i) => (i === playerIndex ? h.filter((_, ci) => ci !== cardIndex) : h));
    const plays = [...game.currentTrick.plays, { playerIndex, card }];
    const ledSuit = game.currentTrick.plays.length === 0 ? card.suit : game.currentTrick.ledSuit;
    setPendingCard(null);

    if (plays.length < 4) {
      setGame({ ...game, hands, currentTrick: { ...game.currentTrick, plays, ledSuit } });
      return;
    }

    const winner = resolveTrickWinner(plays, game.trumpSuit);
    const tricksWon = [...game.tricksWon];
    tricksWon[winner] += 1;
    setGame({
      ...game,
      hands,
      tricksWon,
      currentTrick: { ...game.currentTrick, plays, ledSuit },
      lastTrick: { plays, winner },
      phase: "trickComplete",
    });
  }

  function continueAfterTrick() {
    const winner = game.lastTrick.winner;
    const trickNumber = game.trickNumber + 1;
    if (trickNumber === game.handSize) {
      const scores = [0, 1, 2, 3].map((i) => scoreFor(game.bids[i], game.tricksWon[i]));
      const totals = game.totals.map((t, i) => t + scores[i]);
      const historyEntry = {
        handIndex: game.handIndex,
        handSize: game.handSize,
        bids: [...game.bids],
        won: [...game.tricksWon],
        scores,
      };
      const history = [...game.history, historyEntry];
      setGame({ ...game, totals, history, phase: "handSummary" });
      return;
    }
    setGame({
      ...game,
      trickNumber,
      currentTrick: { leaderIndex: winner, plays: [], ledSuit: null },
      lastTrick: null,
      phase: "playing",
    });
    setPendingCard(null);
  }

  function nextHand() {
    const nextIndex = game.handIndex + 1;
    if (nextIndex >= HAND_SIZES.length) {
      setGame({ ...game, phase: "gameOver" });
      return;
    }
    const nextDealer = (game.dealerIndex + 1) % 4;
    setGame(dealHand(nextDealer, nextIndex, game.totals, game.history));
  }

  const currentBidder = game.phase === "bidding" ? game.bidOrder[game.bidTurnPos] : null;
  const currentTurnPlayer =
    game.phase === "playing" ? (game.currentTrick.leaderIndex + game.currentTrick.plays.length) % 4 : null;
  const displayNames = names.map((n, i) => (n.trim() === "" ? DEFAULT_NAMES[i] : n));

  return (
    <div className="max-w-md mx-auto p-3 font-sans">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-lg font-medium">Trumps</h1>
        <button onClick={newGame} className="text-xs text-gray-500 border border-gray-300 rounded px-2 py-1">
          New game
        </button>
      </div>

      <div className="flex gap-1 mb-3 bg-gray-100 rounded-lg p-1">
        <button
          onClick={() => setTab("game")}
          className={"flex-1 text-xs rounded-md py-1.5 " + (tab === "game" ? "bg-white shadow-sm font-medium" : "text-gray-500")}
        >
          Game
        </button>
        <button
          onClick={() => setTab("tally")}
          className={"flex-1 text-xs rounded-md py-1.5 " + (tab === "tally" ? "bg-white shadow-sm font-medium" : "text-gray-500")}
        >
          Tally
        </button>
      </div>

      <Scoreboard game={game} names={displayNames} />

      {tab === "tally" && <TallyTab game={game} names={displayNames} />}

      {tab === "game" && (
        <>
          <div className="grid grid-cols-2 gap-1.5 mb-3">
            {names.map((name, i) => (
              <input
                key={i}
                value={name}
                onChange={(e) => updateName(i, e.target.value)}
                placeholder={DEFAULT_NAMES[i]}
                className="text-xs border border-gray-200 rounded px-2 py-1 min-w-0"
              />
            ))}
          </div>

          <div className="flex items-center justify-between text-xs text-gray-600 mb-3">
            <span>
              Hand {game.handIndex + 1} of {HAND_SIZES.length} · {game.handSize} cards
            </span>
            <span>Dealer: {displayNames[game.dealerIndex]}</span>
          </div>

          <div className="flex items-center gap-2 mb-4 bg-gray-100 rounded-lg px-3 py-2">
            <span className="text-xs text-gray-500">Trump</span>
            <span
              className={"text-xl " + (game.trumpSuit === "H" || game.trumpSuit === "D" ? "text-red-600" : "text-gray-900")}
            >
              {SUIT_SYMBOL[game.trumpSuit]}
            </span>
            <span className="text-xs text-gray-500">
              (turned {game.trumpCard.rank}
              {SUIT_SYMBOL[game.trumpCard.suit]})
            </span>
          </div>

          {(() => {
            const bidTotal = game.bids.reduce((sum, b) => sum + (b || 0), 0);
            const over = bidTotal > game.handSize;
            return (
              <div className="flex items-center gap-2 mb-4 -mt-2">
                <span className="text-xs text-gray-500">Bids so far</span>
                <span className={"text-sm font-medium " + (over ? "text-red-600" : "text-gray-700")}>
                  {bidTotal} / {game.handSize}
                </span>
              </div>
            );
          })()}

          {game.phase === "bidding" && (
            <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="text-sm font-medium mb-2">
                {displayNames[currentBidder]} to bid
                {currentBidder === game.dealerIndex ? " (dealer)" : ""}
              </div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {Array.from({ length: game.handSize + 1 }, (_, n) => n).map((n) => (
                  <button
                    key={n}
                    onClick={() => setPendingBid(n)}
                    className={
                      "w-9 h-9 rounded-full border text-sm active:scale-95 " +
                      (pendingBid === n
                        ? "border-gray-900 bg-gray-900 text-white"
                        : "border-gray-300 bg-white hover:border-gray-500")
                    }
                  >
                    {n}
                  </button>
                ))}
              </div>
              <button
                onClick={confirmBid}
                disabled={pendingBid === null}
                className={
                  "w-full text-sm rounded-lg py-2 " +
                  (pendingBid === null ? "bg-gray-200 text-gray-400 cursor-not-allowed" : "bg-gray-900 text-white")
                }
              >
                Confirm bid{pendingBid !== null ? ` of ${pendingBid}` : ""}
              </button>
            </div>
          )}

          {(game.phase === "playing" || game.phase === "trickComplete") && (
            <div className="mb-4 bg-gray-100 rounded-lg p-3">
              <div className="text-xs text-gray-500 mb-2">
                Trick {game.trickNumber + 1} of {game.handSize}
                {game.trickNumber === 0 && " · forced trump lead"}
              </div>
              <div className="flex gap-2 min-h-[4rem]">
                {[0, 1, 2, 3].map((seat) => {
                  const play = game.currentTrick.plays.find((p) => p.playerIndex === seat);
                  const isWinner = game.lastTrick && game.lastTrick.winner === seat;
                  return (
                    <div key={seat} className="flex-1 flex flex-col items-center gap-1">
                      <span className={"text-[10px] " + (isWinner ? "text-emerald-700 font-medium" : "text-gray-500")}>
                        {displayNames[seat]}
                        {isWinner ? " ✓" : ""}
                      </span>
                      {play ? <Card card={play.card} disabled small /> : <div className="w-10 h-14" />}
                    </div>
                  );
                })}
              </div>
              {game.phase === "trickComplete" && (
                <button onClick={continueAfterTrick} className="mt-3 w-full bg-gray-900 text-white text-sm rounded-lg py-2">
                  Continue
                </button>
              )}
              {game.phase === "playing" && pendingCard && (
                <button onClick={confirmPlay} className="mt-3 w-full bg-gray-900 text-white text-sm rounded-lg py-2">
                  Confirm play: {displayNames[pendingCard.playerIndex]}'s{" "}
                  {game.hands[pendingCard.playerIndex][pendingCard.cardIndex].rank}
                  {SUIT_SYMBOL[game.hands[pendingCard.playerIndex][pendingCard.cardIndex].suit]}
                </button>
              )}
            </div>
          )}

          {game.phase !== "handSummary" && game.phase !== "gameOver" && (
            <div className="space-y-2">
              {displayNames.map((name, i) => (
                <div
                  key={i}
                  className={
                    "rounded-lg border p-2 " +
                    (currentTurnPlayer === i || currentBidder === i ? "border-amber-400 bg-amber-50" : "border-gray-200")
                  }
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium">{name}</span>
                    <span className="text-[11px] text-gray-500">
                      {game.bids[i] !== null ? `bid ${game.bids[i]}` : "no bid yet"}
                      {game.phase === "playing" || game.phase === "trickComplete" ? ` · won ${game.tricksWon[i]}` : ""}
                    </span>
                  </div>
                  <div className="flex gap-1.5 overflow-x-auto pb-1">
                    {game.hands[i].map((card, ci) => {
                      const canPlay = game.phase === "playing" && currentTurnPlayer === i && isCardLegal(game, i, card);
                      const isSelected =
                        pendingCard && pendingCard.playerIndex === i && pendingCard.cardIndex === ci;
                      const prevCard = ci > 0 ? game.hands[i][ci - 1] : null;
                      const showDivider = prevCard && prevCard.suit !== card.suit;
                      return (
                        <>
                          {showDivider && <div className="w-px bg-gray-300 self-stretch shrink-0" />}
                          <Card
                            key={card.suit + card.rank}
                            card={card}
                            small
                            disabled={!canPlay}
                            selected={isSelected}
                            onClick={() => selectCard(i, ci)}
                          />
                        </>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {game.phase === "handSummary" && (
            <div className="bg-gray-100 rounded-lg p-3">
              <div className="text-sm font-medium mb-2">Hand {game.handIndex + 1} result</div>
              <table className="w-full text-xs mb-3">
                <thead>
                  <tr className="text-gray-500">
                    <td className="py-1">Player</td>
                    <td className="py-1 text-center">Bid</td>
                    <td className="py-1 text-center">Won</td>
                    <td className="py-1 text-center">Score</td>
                    <td className="py-1 text-right">Total</td>
                  </tr>
                </thead>
                <tbody>
                  {displayNames.map((name, i) => {
                    const delta = scoreFor(game.bids[i], game.tricksWon[i]);
                    return (
                      <tr key={i} className="border-t border-gray-200">
                        <td className="py-1">{name}</td>
                        <td className="py-1 text-center">{game.bids[i]}</td>
                        <td className="py-1 text-center">{game.tricksWon[i]}</td>
                        <td className={"py-1 text-center " + (delta >= 0 ? "text-emerald-700" : "text-red-600")}>
                          {delta >= 0 ? `+${delta}` : delta}
                        </td>
                        <td className="py-1 text-right font-medium">{game.totals[i]}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <button onClick={nextHand} className="w-full bg-gray-900 text-white text-sm rounded-lg py-2">
                {game.handIndex + 1 === HAND_SIZES.length ? "View final results" : "Next hand"}
              </button>
            </div>
          )}

          {game.phase === "gameOver" && (
            <div className="bg-gray-100 rounded-lg p-4 text-center">
              <div className="text-sm text-gray-500 mb-2">Final results</div>
              {displayNames
                .map((name, i) => ({ name, score: game.totals[i] }))
                .sort((a, b) => b.score - a.score)
                .map((p, rank) => (
                  <div
                    key={p.name}
                    className="flex items-center justify-between py-1.5 border-t border-gray-200 first:border-t-0"
                  >
                    <span className={rank === 0 ? "font-medium" : ""}>
                      {rank === 0 ? "🏆 " : ""}
                      {p.name}
                    </span>
                    <span className={rank === 0 ? "font-medium" : ""}>{p.score}</span>
                  </div>
                ))}
              <button onClick={newGame} className="mt-3 w-full bg-gray-900 text-white text-sm rounded-lg py-2">
                New game
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
