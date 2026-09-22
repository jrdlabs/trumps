const SUIT_SYMBOL={S:"♠",H:"♥",D:"♦",C:"♣"};
const SUIT_ORDER={S:0,H:1,C:2,D:3};
const RANK_ORDER={"2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,"10":10,J:11,Q:12,K:13,A:14};
const parseCard=value=>({value,suit:value[0],rank:value.slice(1)});
const escapeHtml=value=>String(value).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
let selectedBid=null;
let selectedCard=null;
let lastRevision=null;
let lastAnimatedHandKey=null;
let lastPlaySignature="";

function legalCard(game,card){
  if(game.phase!=="playing"||game.turnSeat!==game.mySeat)return false;
  const hand=game.hand.map(parseCard);
  if(game.trickNumber===0)return card.suit===game.trumpSuit||!hand.some(item=>item.suit===game.trumpSuit);
  if(!game.currentTrick.length)return true;
  return card.suit===game.ledSuit||!hand.some(item=>item.suit===game.ledSuit);
}

function cardElement(card,{small=false,disabled=false,selected=false,onClick}={}){
  const button=document.createElement("button");
  button.type="button";
  button.className=`playing-card${card.suit==="H"||card.suit==="D"?" playing-card--red":""}${small?" playing-card--small":""}${selected?" playing-card--selected":""}`;
  const rank=document.createElement("span");rank.textContent=card.rank;
  const suit=document.createElement("b");suit.textContent=SUIT_SYMBOL[card.suit];
  button.append(rank,suit);button.disabled=disabled;
  if(onClick)button.addEventListener("click",onClick);
  return button;
}

export function renderGame({game,players,roomCode,onBid,onPlay,onNextHand,onRestart}){
  if(lastRevision!==game.revision){selectedBid=null;selectedCard=null;lastRevision=game.revision}
  const ordered=players.slice().sort((a,b)=>a.seat-b.seat);
  const bySeat=Object.fromEntries(players.map(player=>[player.seat,player]));
  const me=bySeat[game.mySeat];
  document.querySelector("#game-room-code").textContent=roomCode;
  document.querySelector("#game-hand-title").textContent=`Hand ${game.handIndex+1} of 22 · ${game.handSize} cards`;
  document.querySelector("#game-dealer").textContent=`Dealer: ${bySeat[game.dealerSeat]?.display_name||"—"}`;
  const turned=game.trumpCard?parseCard(game.trumpCard):null;
  const trumpDisplay=document.querySelector("#game-trump");trumpDisplay.replaceChildren();
  const trumpLabel=document.createElement("span");trumpLabel.textContent="Turned trump";trumpDisplay.append(trumpLabel);
  if(turned)trumpDisplay.append(cardElement(turned,{small:true,disabled:true}));

  const scoreboard=document.querySelector("#scoreboard");scoreboard.replaceChildren();
  for(let seat=0;seat<4;seat+=1){
    const item=document.createElement("div");item.className=`score${seat===game.turnSeat?" score--turn":""}`;
    const name=document.createElement("small");name.textContent=`${bySeat[seat]?.display_name||`Seat ${seat+1}`}${seat===game.mySeat?" · You":""}`;
    const total=document.createElement("strong");total.textContent=game.totals?.[seat]??0;
    const stats=document.createElement("div");stats.className="score__stats";const bid=game.bids?.[seat];
    stats.innerHTML=`<span><b>${bid??"—"}</b><small>Bid</small></span><span><b>${game.tricksWon?.[seat]??0}</b><small>Won</small></span>`;
    item.append(name,total,stats);scoreboard.append(item);
  }

  const trick=document.querySelector("#trick-table");trick.replaceChildren();
  const playSignature=(game.currentTrick||[]).map(play=>`${play.seat}:${play.card}`).join("|");
  const newestPlaySeat=playSignature!==lastPlaySignature&&game.currentTrick?.length?game.currentTrick.at(-1).seat:null;
  const leadSeat=game.phase==="trick_complete"?game.lastTrick?.winner:(game.currentTrick?.[0]?.seat??game.turnSeat);
  const tableOrder=Array.from({length:4},(_,offset)=>((leadSeat??0)+offset)%4);
  for(const seat of tableOrder){
    const slot=document.createElement("div");const play=game.currentTrick?.find(item=>item.seat===seat);const won=game.lastTrick?.winner===seat;
    const isLeader=seat===leadSeat;slot.className=`trick-slot${won?" trick-slot--winner":""}${isLeader?" trick-slot--leader":""}${seat===game.turnSeat?" trick-slot--turn":""}`;
    const label=document.createElement("small");label.textContent=`${isLeader?"LEADS · ":""}${bySeat[seat]?.display_name||`Seat ${seat+1}`}${won?" ✓":""}`;slot.append(label);
    if(play){const playedCard=cardElement(parseCard(play.card),{small:true,disabled:true});if(seat===newestPlaySeat)playedCard.classList.add("playing-card--played");slot.append(playedCard)}
    else{const blank=document.createElement("div");blank.className="card-blank";slot.append(blank)}
    trick.append(slot);
  }
  lastPlaySignature=playSignature;

  const action=document.querySelector("#game-action");action.replaceChildren();
  const message=document.createElement("p");
  const addButton=(label,handler)=>{const button=document.createElement("button");button.type="button";button.className="button button--primary";button.textContent=label;button.addEventListener("click",handler);action.append(button)};
  if(game.phase==="bidding"){
    const bidder=bySeat[game.turnSeat]?.display_name||"Player";message.textContent=game.turnSeat===game.mySeat?"Choose how many packs you will win.":`Waiting for ${bidder} to bid…`;action.append(message);
    if(game.turnSeat===game.mySeat){
      const choices=document.createElement("div");choices.className="bid-choices";
      const confirm=document.createElement("button");confirm.type="button";confirm.className="button button--primary bid-confirm";
      const updateBid=()=>{choices.querySelectorAll("button").forEach(button=>button.classList.toggle("bid-choice--selected",Number(button.dataset.bid)===selectedBid));confirm.disabled=selectedBid===null;confirm.textContent=selectedBid===null?"Select your bid":`Confirm bid of ${selectedBid}`};
      for(let bid=0;bid<=game.handSize;bid+=1){const button=document.createElement("button");button.type="button";button.dataset.bid=bid;button.textContent=bid;button.addEventListener("click",()=>{selectedBid=bid;updateBid()});choices.append(button)}
      confirm.addEventListener("click",()=>{if(selectedBid!==null){const bid=selectedBid;selectedBid=null;onBid(bid)}});
      action.append(choices,confirm);updateBid();
    }
  }else if(game.phase==="playing"){
    message.textContent=game.turnSeat===game.mySeat?(game.trickNumber===0?"Your turn · you must play trump if you have one.":"Your turn · choose a legal card."):`Waiting for ${bySeat[game.turnSeat]?.display_name||"player"}…`;action.append(message);
  }else if(game.phase==="trick_complete"){
    const completedAt=Date.parse(game.trickCompletedAt||"");
    const seconds=Number.isFinite(completedAt)?Math.max(0,Math.ceil((completedAt+5000-Date.now())/1000)):5;
    message.textContent=`${bySeat[game.lastTrick.winner]?.display_name||"Player"} won the trick. ${game.trickNumber+1===game.handSize?"Hand result":"Next trick"} in ${seconds}s…`;action.append(message);
    const countdown=document.createElement("div");countdown.className="trick-countdown";countdown.innerHTML="<i></i>";action.append(countdown);
  }else if(game.phase==="hand_complete"){
    message.textContent="Hand complete. Scores have been added.";action.append(message);if(me?.is_host)addButton("Deal next hand",onNextHand);else message.textContent+=" Waiting for the host to deal.";
  }else if(game.phase==="game_complete"){
    const rankings=players.map(player=>({name:player.display_name,score:game.totals[player.seat]})).sort((a,b)=>b.score-a.score);message.textContent=`🏆 ${rankings[0].name} wins with ${rankings[0].score} points!`;action.append(message);if(me?.is_host)addButton("Play another game",onRestart);
  }

  const hand=document.querySelector("#my-hand");hand.replaceChildren();
  const cards=(game.hand||[]).map(parseCard).sort((a,b)=>SUIT_ORDER[a.suit]-SUIT_ORDER[b.suit]||RANK_ORDER[a.rank]-RANK_ORDER[b.rank]);
  const handAnimationKey=`${roomCode}:${game.handIndex}`;
  const animateDeal=lastAnimatedHandKey!==handAnimationKey&&cards.length>0;
  let dealtCardIndex=0;
  const rowSize=cards.length>6?Math.ceil(cards.length/2):cards.length||1;
  for(let start=0;start<cards.length;start+=rowSize){
    const row=document.createElement("div");row.className="card-row";
    cards.slice(start,start+rowSize).forEach((card,index)=>{
      const playable=legalCard(game,card);
      const button=cardElement(card,{disabled:!playable,selected:selectedCard===card.value,onClick:()=>{
        if(selectedCard===card.value){selectedCard=null;onPlay(card.value);return}
        selectedCard=card.value;hand.querySelectorAll(".playing-card--selected").forEach(item=>item.classList.remove("playing-card--selected"));button.classList.add("playing-card--selected");
      }});
      if(animateDeal){button.classList.add("playing-card--dealt");button.style.setProperty("--deal-delay",`${dealtCardIndex*70}ms`);dealtCardIndex+=1}
      button.style.zIndex=index+1;row.append(button);
    });
    hand.append(row);
  }
  if(animateDeal)lastAnimatedHandKey=handAnimationKey;
  document.querySelector("#hand-help").textContent=game.turnSeat===game.mySeat&&game.phase==="playing"?"Tap once to select · again to play":`${cards.length} card${cards.length===1?"":"s"}`;

  const myTricks=game.myWonTricks||[];
  document.querySelector("#my-tricks-count").textContent=myTricks.length;
  const tricksWrap=document.querySelector("#my-tricks");tricksWrap.replaceChildren();
  if(!myTricks.length){const empty=document.createElement("p");empty.className="empty-tricks";empty.textContent="You have not won a trick yet.";tricksWrap.append(empty)}
  for(const wonTrick of myTricks.slice().reverse()){
    const item=document.createElement("article");item.className="won-trick";
    const title=document.createElement("strong");title.textContent=`Hand ${wonTrick.handIndex+1} · Trick ${wonTrick.trickNumber+1}`;
    const cards=document.createElement("div");cards.className="won-trick__cards";
    (wonTrick.plays||[]).forEach(play=>cards.append(cardElement(parseCard(play.card),{small:true,disabled:true})));
    item.append(title,cards);tricksWrap.append(item);
  }

  const tally=document.querySelector("#tally-table");
  const headings=ordered.map(player=>`<th class="player-group" colspan="3">${escapeHtml(player.display_name)}</th>`).join("");
  const subheads=ordered.map(()=>"<th class=\"player-start\">B</th><th>W</th><th>Pts</th>").join("");
  const rows=(game.history||[]).map(row=>`<tr><td>${row.handSize}</td>${ordered.map(player=>`<td class="player-start">${row.bids[player.seat]}</td><td>${row.won[player.seat]}</td><td>${row.scores[player.seat]>=0?"+":""}${row.scores[player.seat]}</td>`).join("")}</tr>`).join("");
  const totals=ordered.map(player=>`<td class="player-start" colspan="3"><strong>${game.totals[player.seat]}</strong></td>`).join("");
  tally.innerHTML=`<table><thead><tr><th>Cards</th>${headings}</tr><tr><th></th>${subheads}</tr></thead><tbody>${rows||`<tr><td colspan="13">No completed hands yet</td></tr>`}</tbody><tfoot><tr><td>Total</td>${totals}</tr></tfoot></table>`;
}
