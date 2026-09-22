import { useState, useRef, useEffect } from "react";

const SUIT_SYMBOL = { S: "♠", H: "♥", D: "♦", C: "♣" };
const RED_SUITS = ["H", "D"];

const INITIAL_HAND = [
  { suit: "S", rank: "A" },
  { suit: "S", rank: "K" },
  { suit: "S", rank: "7" },
  { suit: "H", rank: "K" },
  { suit: "H", rank: "9" },
  { suit: "H", rank: "4" },
  { suit: "C", rank: "Q" },
  { suit: "C", rank: "8" },
  { suit: "C", rank: "4" },
  { suit: "D", rank: "J" },
  { suit: "D", rank: "9" },
  { suit: "D", rank: "2" },
];

const OPPONENT_ORDER = ["left", "top", "right"];
const SEAT_NAME = { left: "Tom", top: "John", right: "Sue", bottom: "You" };

const SCRIPT = [
  { left: { suit: "H", rank: "9" }, top: { suit: "C", rank: "K" }, right: { suit: "D", rank: "2" }, winner: "right" },
  { left: { suit: "S", rank: "Q" }, top: { suit: "H", rank: "4" }, right: { suit: "C", rank: "8" }, winner: "bottom" },
  { left: { suit: "D", rank: "K" }, top: { suit: "S", rank: "10" }, right: { suit: "H", rank: "6" }, winner: "top" },
  { left: { suit: "C", rank: "A" }, top: { suit: "D", rank: "7" }, right: { suit: "S", rank: "3" }, winner: "left" },
];

const SEAT_POS = {
  left: { left: 8, top: 44 },
  top: { left: 50, top: 9 },
  right: { left: 92, top: 44 },
};

function rowLayout(total) {
  if (total <= 6) return [total];
  const row0 = Math.ceil(total / 2);
  return [row0, total - row0];
}

function rowInfoForIndex(index, total) {
  const rows = rowLayout(total);
  if (rows.length === 1) return { row: 0, idxInRow: index, rowCount: rows[0] };
  if (index < rows[0]) return { row: 0, idxInRow: index, rowCount: rows[0] };
  return { row: 1, idxInRow: index - rows[0], rowCount: rows[1] };
}

function handCardStyle(index, total, lifted) {
  const { row, idxInRow, rowCount } = rowInfoForIndex(index, total);
  const spread = Math.min(64, (rowCount - 1) * 14 + 10);
  const anglePer = rowCount > 1 ? spread / (rowCount - 1) : 0;
  const angle = rowCount > 1 ? -spread / 2 + idxInRow * anglePer : 0;
  const rad = (angle * Math.PI) / 180;
  const rowLift = row === 1 ? 15 : 0;
  const left = 50 + Math.sin(rad) * 38;
  const top = 101 - Math.cos(rad) * 24 - rowLift - (lifted ? 13 : 0);
  const scale = (row === 1 ? 0.92 : 1) * (lifted ? 1.08 : 1);
  return {
    left: `${left}%`,
    top: `${top}%`,
    transform: `translate(-50%, -50%) rotate(${angle}deg) scale(${scale})`,
    zIndex: (row === 0 ? 100 : 50) + idxInRow + (lifted ? 500 : 0),
  };
}

function trickSlotStyle(order) {
  const dx = (order - 1.5) * 15;
  return { left: `${50 + dx}%`, top: "42%", transform: "translate(-50%, -50%)", zIndex: 20 + order };
}

function seatStyle(seat) {
  const p = SEAT_POS[seat];
  return { left: `${p.left}%`, top: `${p.top}%`, transform: "translate(-50%, -50%)", zIndex: 15 };
}

function PlayingCard({ suit, rank, faceDown, style, onClick }) {
  const red = RED_SUITS.includes(suit);
  const size = "w-[13%] aspect-[5/7] min-w-[38px] text-[3.2vw] sm:text-sm";
  if (faceDown) {
    return (
      <div
        style={{ position: "absolute", transition: "all 500ms cubic-bezier(0.22,1,0.36,1)", ...style }}
        className={size + " rounded-lg border-2 border-red-950"}
      >
        <div
          className="w-full h-full rounded-md"
          style={{
            background: "repeating-linear-gradient(45deg, #7a1020, #7a1020 4px, #5c0c18 4px, #5c0c18 8px)",
            border: "2px solid #3d0a12",
            borderRadius: "6px",
          }}
        />
      </div>
    );
  }
  return (
    <button
      onClick={onClick}
      style={{ position: "absolute", transition: "all 500ms cubic-bezier(0.22,1,0.36,1)", ...style }}
      className={
        size +
        " rounded-lg bg-white border border-gray-300 shadow-lg flex items-center justify-center " +
        (onClick ? "cursor-pointer active:brightness-95" : "")
      }
    >
      <span className={"absolute top-[6%] left-[8%] leading-none font-semibold " + (red ? "text-red-600" : "text-gray-900")}>
        <div>{rank}</div>
        <div className="-mt-0.5">{SUIT_SYMBOL[suit]}</div>
      </span>
      <span className={"text-[2.6em] " + (red ? "text-red-600" : "text-gray-900")}>{SUIT_SYMBOL[suit]}</span>
      <span
        className={
          "absolute bottom-[6%] right-[8%] leading-none font-semibold rotate-180 " + (red ? "text-red-600" : "text-gray-900")
        }
      >
        <div>{rank}</div>
        <div className="-mt-0.5">{SUIT_SYMBOL[suit]}</div>
      </span>
    </button>
  );
}

function OpponentSeat({ seat, isTurn, pileCount }) {
  return (
    <div style={{ position: "absolute", ...seatStyle(seat) }} className="flex flex-col items-center gap-1.5">
      <div
        className={
          "px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap " +
          (isTurn ? "bg-amber-300 text-amber-900 ring-2 ring-amber-200" : "bg-black/35 text-white")
        }
      >
        {SEAT_NAME[seat]}
      </div>
      <div className="relative w-9 h-12" style={{ filter: "drop-shadow(0 2px 5px rgba(0,0,0,0.4))" }}>
        <div
          className="w-full h-full rounded-md border-2 border-red-950"
          style={{ background: "repeating-linear-gradient(45deg, #7a1020, #7a1020 3px, #5c0c18 3px, #5c0c18 6px)" }}
        />
        <span className="absolute -bottom-1.5 -right-1.5 bg-white text-gray-900 text-[10px] font-semibold rounded-full w-5 h-5 flex items-center justify-center border border-gray-300">
          {pileCount}
        </span>
      </div>
    </div>
  );
}

let cardUid = 0;

export default function TrumpsTableMockup() {
  const [playerHand, setPlayerHand] = useState(() => INITIAL_HAND.map((c) => ({ ...c, id: `p-${cardUid++}` })));
  const [liftedId, setLiftedId] = useState(null);
  const [tableCards, setTableCards] = useState([]);
  const [pileCounts, setPileCounts] = useState({ left: 0, top: 0, right: 0, bottom: 0 });
  const [phase, setPhase] = useState("playerTurn");
  const [oppStep, setOppStep] = useState(0);
  const [trickIndex, setTrickIndex] = useState(0);
  const [resolvingToPile, setResolvingToPile] = useState(null);

  const timers = useRef([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  function spawnCard(card, spawnStyle, order) {
    const id = `t-${cardUid++}`;
    setTableCards((prev) => [...prev, { ...card, id, order, settled: false, spawnStyle }]);
    const t = setTimeout(() => {
      setTableCards((prev) => prev.map((c) => (c.id === id ? { ...c, settled: true } : c)));
    }, 30);
    timers.current.push(t);
  }

  function selectCard(id) {
    if (phase !== "playerTurn") return;
    if (liftedId === id) playCard(id);
    else setLiftedId(id);
  }

  function playCard(id) {
    const index = playerHand.findIndex((c) => c.id === id);
    const card = playerHand[index];
    const spawnStyle = handCardStyle(index, playerHand.length, false);
    setPlayerHand((prev) => prev.filter((c) => c.id !== id));
    setLiftedId(null);
    spawnCard({ seat: "bottom", suit: card.suit, rank: card.rank }, spawnStyle, 0);
    setPhase("oppTurn");
    setOppStep(0);
  }

  function advanceOpponent() {
    const seat = OPPONENT_ORDER[oppStep];
    const card = SCRIPT[trickIndex][seat];
    spawnCard({ seat, suit: card.suit, rank: card.rank }, { ...seatStyle(seat) }, oppStep + 1);
    if (oppStep < 2) setOppStep(oppStep + 1);
    else setPhase("resolving");
  }

  function resolveTrick() {
    const winner = SCRIPT[trickIndex].winner;
    setResolvingToPile(winner);
    const t = setTimeout(() => {
      setTableCards([]);
      setResolvingToPile(null);
      setPileCounts((prev) => ({ ...prev, [winner]: prev[winner] + 1 }));
      setTrickIndex((prev) => (prev + 1) % SCRIPT.length);
      setPhase("playerTurn");
      setPlayerHand((prev) => (prev.length === 0 ? INITIAL_HAND.map((c) => ({ ...c, id: `p-${cardUid++}` })) : prev));
    }, 550);
    timers.current.push(t);
  }

  const nextLabel =
    phase === "oppTurn" ? `Next: ${SEAT_NAME[OPPONENT_ORDER[oppStep]]} plays` : phase === "resolving" ? "Resolve trick" : null;

  function handleNext() {
    if (phase === "oppTurn") advanceOpponent();
    else if (phase === "resolving") resolveTrick();
  }

  return (
    <div className="w-full min-h-screen flex flex-col items-center justify-center p-2" style={{ background: "#052818" }}>
      <div
        className="relative w-full"
        style={{
          maxWidth: "520px",
          aspectRatio: "10 / 17",
          maxHeight: "92vh",
          background: "radial-gradient(ellipse at center, #1e7a52 0%, #10603f 55%, #073a24 100%)",
          borderRadius: "26px",
          border: "9px solid #6b4423",
          boxShadow: "inset 0 0 40px rgba(0,0,0,0.35), 0 4px 20px rgba(0,0,0,0.4)",
        }}
      >
        <OpponentSeat seat="left" isTurn={phase === "oppTurn" && OPPONENT_ORDER[oppStep] === "left"} pileCount={pileCounts.left} />
        <OpponentSeat seat="top" isTurn={phase === "oppTurn" && OPPONENT_ORDER[oppStep] === "top"} pileCount={pileCounts.top} />
        <OpponentSeat seat="right" isTurn={phase === "oppTurn" && OPPONENT_ORDER[oppStep] === "right"} pileCount={pileCounts.right} />

        <div style={{ position: "absolute", left: "6%", bottom: "3%" }} className="flex flex-col items-center gap-1">
          <div className="relative w-8 h-11" style={{ filter: "drop-shadow(0 2px 5px rgba(0,0,0,0.4))" }}>
            <div
              className="w-full h-full rounded-md border-2 border-red-950"
              style={{ background: "repeating-linear-gradient(45deg, #7a1020, #7a1020 3px, #5c0c18 3px, #5c0c18 6px)" }}
            />
            <span className="absolute -bottom-1.5 -right-1.5 bg-white text-gray-900 text-[10px] font-semibold rounded-full w-5 h-5 flex items-center justify-center border border-gray-300">
              {pileCounts.bottom}
            </span>
          </div>
          <div className="text-[10px] text-white/70">You</div>
        </div>

        {tableCards.map((c) => {
          const style = resolvingToPile ? seatStyle(resolvingToPile) : c.settled ? trickSlotStyle(c.order) : c.spawnStyle;
          return <PlayingCard key={c.id} suit={c.suit} rank={c.rank} faceDown={!!resolvingToPile} style={style} />;
        })}

        {playerHand.map((c, i) => (
          <PlayingCard
            key={c.id}
            suit={c.suit}
            rank={c.rank}
            style={handCardStyle(i, playerHand.length, liftedId === c.id)}
            onClick={() => selectCard(c.id)}
          />
        ))}

        {phase === "playerTurn" && (
          <div
            style={{ position: "absolute", left: "50%", top: "2%", transform: "translateX(-50%)" }}
            className="bg-amber-300 text-amber-900 text-xs font-medium px-2.5 py-1 rounded-full"
          >
            Your turn
          </div>
        )}
      </div>

      <div className="mt-3 text-center text-xs text-white/60 h-4">
        {phase === "playerTurn" && liftedId === null && "Tap a card to lift it"}
        {phase === "playerTurn" && liftedId !== null && "Tap it again to play"}
      </div>

      {nextLabel && (
        <button onClick={handleNext} className="mt-2 w-full max-w-[520px] bg-gray-900 text-white text-sm rounded-lg py-2.5">
          {nextLabel}
        </button>
      )}
    </div>
  );
}
