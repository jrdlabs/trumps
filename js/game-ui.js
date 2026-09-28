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
let collectionTimer;
let actionCountdownTimer;

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
  button.className=`playing-card${card.suit==="H"||card.suit==="D"?" playing-card--red":""}${card.suit==="C"?" playing-card--club":""}${small?" playing-card--small":""}${selected?" playing-card--selected":""}`;
  const rank=document.createElement("span");rank.textContent=card.rank;
  const suit=document.createElement("b");suit.textContent=SUIT_SYMBOL[card.suit];
  button.append(rank,suit);button.disabled=disabled;
  if(onClick)button.addEventListener("click",onClick);
  return button;
}

const initials=name=>String(name||"?").trim().split(/\s+/).map(part=>part[0]).join("").slice(0,2).toUpperCase();

function relativePosition(mySeat,seat){
  return ["self","left","top","right"][(seat-mySeat+4)%4];
}

function appendFacedownTricks(container,count,{large=false}={}){
  const row=document.createElement("span");row.className=`facedown-tricks${large?" facedown-tricks--large":""}`;
  const visible=Math.min(count,5);
  for(let index=0;index<visible;index+=1){
    const card=document.createElement("i");card.className="facedown-trick";card.style.setProperty("--pile-index",index);row.append(card);
  }
  if(!count){const empty=document.createElement("i");empty.className="facedown-trick facedown-trick--empty";row.append(empty)}
  const tally=document.createElement("b");tally.textContent=count;row.append(tally);container.append(row);
}

function renderSeats(game,players,bySeat){
  const opponents=document.querySelector("#opponent-seats");opponents.replaceChildren();
  for(let seat=0;seat<4;seat+=1){
    if(seat===game.mySeat)continue;
    const player=bySeat[seat];const position=relativePosition(game.mySeat,seat);
    const item=document.createElement("div");item.className=`table-seat table-seat--${position}${seat===game.turnSeat?" table-seat--turn":""}`;
    const avatar=document.createElement("span");avatar.className="table-seat__avatar";avatar.textContent=initials(player?.display_name);
    const info=document.createElement("span");info.className="table-seat__info";
    const name=document.createElement("strong");name.textContent=player?.display_name||`Seat ${seat+1}`;
    const status=document.createElement("small");status.textContent=seat===game.turnSeat?"PLAY":"";
    const bid=document.createElement("span");bid.className="table-seat__bid";bid.textContent=`Bid ${game.bids?.[seat]??"—"}`;info.append(name,status);item.append(avatar,info,bid);appendFacedownTricks(item,game.tricksWon?.[seat]??0);opponents.append(item);
  }

  const self=document.querySelector("#my-seat-summary");self.replaceChildren();self.className=`my-seat-summary${game.turnSeat===game.mySeat?" my-seat-summary--turn":""}`;
  const label=document.createElement("strong");label.textContent="YOU";
  const bid=document.createElement("span");bid.innerHTML=`Bid <b>${game.bids?.[game.mySeat]??"—"}</b>`;
  const won=document.createElement("span");won.innerHTML=`Won <b>${game.tricksWon?.[game.mySeat]??0}</b>`;
  self.append(label,bid,won);

  const pile=document.querySelector("#my-won-pile");pile.replaceChildren();
  const pileLabel=document.createElement("span");pileLabel.textContent="Your tricks";pile.append(pileLabel);
  appendFacedownTricks(pile,game.tricksWon?.[game.mySeat]??0,{large:true});
}

function renderTableCards(game){
  const trick=document.querySelector("#trick-table");trick.replaceChildren();trick.className="trick-table";
  const playSignature=(game.currentTrick||[]).map(play=>`${play.seat}:${play.card}`).join("|");
  const newestSeat=playSignature!==lastPlaySignature&&game.currentTrick?.length?game.currentTrick.at(-1).seat:null;
  for(const play of game.currentTrick||[]){
    const position=relativePosition(game.mySeat,play.seat);
    const card=cardElement(parseCard(play.card),{small:true,disabled:true});
    card.classList.add("table-played-card",`table-played-card--${position}`);
    if(play.seat===newestSeat)card.classList.add("table-played-card--enter");
    trick.append(card);
  }
  lastPlaySignature=playSignature;

  clearTimeout(collectionTimer);
  if(game.phase==="trick_complete"&&game.lastTrick){
    const completedAt=Date.parse(game.trickCompletedAt||"");
    const elapsed=Number.isFinite(completedAt)?Date.now()-completedAt:0;
    const collect=()=>{
      if(game.phase!=="trick_complete")return;
      trick.classList.add("trick-table--collecting");
      const packet=document.createElement("span");
      packet.className=`trick-packet trick-packet--to-${relativePosition(game.mySeat,game.lastTrick.winner)}`;
      trick.append(packet);
    };
    const remaining=Math.max(0,5000-elapsed);
    if(remaining)collectionTimer=setTimeout(collect,remaining);
    else requestAnimationFrame(()=>requestAnimationFrame(collect));
  }
}

function renderAction(game,bySeat,me,onBid,onNextHand,onLeave,onClose){
  const action=document.querySelector("#game-action");
  const trickKey=game.phase==="trick_complete"?`${game.handIndex}:${game.trickNumber}:${game.trickCompletedAt}`:"";
  if(trickKey&&action.dataset.trickKey===trickKey)return;
  clearInterval(actionCountdownTimer);action.dataset.trickKey=trickKey;action.replaceChildren();
  const message=document.createElement("p");
  const addButton=(label,handler)=>{const button=document.createElement("button");button.type="button";button.className="button button--primary";button.textContent=label;button.addEventListener("click",handler);action.append(button)};
  if(game.phase==="bidding"){
    const bidder=bySeat[game.turnSeat]?.display_name||"Player";message.textContent=game.turnSeat===game.mySeat?"Choose how many tricks you will win.":`Waiting for ${bidder} to bid…`;action.append(message);
    if(game.turnSeat===game.mySeat){
      const choices=document.createElement("div");choices.className="bid-choices";
      const confirm=document.createElement("button");confirm.type="button";confirm.className="button button--primary bid-confirm";
      const updateBid=()=>{choices.querySelectorAll("button").forEach(button=>button.classList.toggle("bid-choice--selected",Number(button.dataset.bid)===selectedBid));confirm.disabled=selectedBid===null;confirm.textContent=selectedBid===null?"Select your bid":`Confirm bid of ${selectedBid}`};
      for(let bid=0;bid<=game.handSize;bid+=1){const button=document.createElement("button");button.type="button";button.dataset.bid=bid;button.textContent=bid;button.addEventListener("click",()=>{selectedBid=bid;updateBid()});choices.append(button)}
      confirm.addEventListener("click",()=>{if(selectedBid!==null){const bid=selectedBid;selectedBid=null;onBid(bid)}});action.append(choices,confirm);updateBid();
    }
  }else if(game.phase==="playing"){
    message.textContent=game.turnSeat===game.mySeat?(game.trickNumber===0?"Your turn · play trump if you have one.":"Your turn · choose a legal card."):`Waiting for ${bySeat[game.turnSeat]?.display_name||"player"}…`;action.append(message);
  }else if(game.phase==="trick_complete"){
    const completedAt=Date.parse(game.trickCompletedAt||"");
    const updateCountdown=()=>{const remaining=Number.isFinite(completedAt)?completedAt+5000-Date.now():5000;const seconds=Math.max(0,Math.ceil(remaining/1000));message.textContent=remaining>0?`${bySeat[game.lastTrick.winner]?.display_name||"Player"} won · ${game.trickNumber+1===game.handSize?"Hand result":"next trick"} in ${seconds}s`:"Collecting trick…";};
    updateCountdown();action.append(message);actionCountdownTimer=setInterval(updateCountdown,200);
    const countdown=document.createElement("div");countdown.className="trick-countdown";const bar=document.createElement("i");const initialRemaining=Number.isFinite(completedAt)?completedAt+5000-Date.now():5000;const barRemaining=Math.max(0,Math.min(5000,initialRemaining));bar.style.setProperty("--countdown-start",String(barRemaining/5000));bar.style.animationDuration=`${Math.max(1,barRemaining)}ms`;countdown.append(bar);action.append(countdown);
  }else if(game.phase==="hand_complete"){
    message.textContent="Hand complete. Scores have been added.";action.append(message);if(me?.is_host)addButton("Deal next hand",onNextHand);else message.textContent+=" Waiting for the host to deal.";
  }else if(game.phase==="game_complete"){
    action.classList.add("game-action--results");
    const rankings=Object.values(bySeat).map(player=>({name:player.display_name,score:game.totals[player.seat]})).sort((a,b)=>b.score-a.score);
    const topScore=rankings[0]?.score??0;const winners=rankings.filter(player=>player.score===topScore);
    const celebration=document.createElement("div");celebration.className="result-celebration";celebration.setAttribute("aria-hidden","true");
    for(let index=0;index<8;index+=1){const spark=document.createElement("i");spark.style.setProperty("--spark",index);celebration.append(spark)}
    const crown=document.createElement("div");crown.className="result-crown";crown.textContent="♛";
    const title=document.createElement("h3");title.className="result-title";title.textContent=winners.length>1?"It’s a tie!":`${winners[0].name} wins!`;
    const subtitle=document.createElement("p");subtitle.className="result-subtitle";subtitle.textContent=winners.length>1?`${winners.map(player=>player.name).join(" & ")} · ${topScore} points`:`${topScore} points`;
    const list=document.createElement("div");list.className="result-rankings";
    rankings.forEach((player,index)=>{const row=document.createElement("div");row.className=`result-rank${player.score===topScore?" result-rank--winner":""}`;const place=document.createElement("span");place.textContent=`#${index+1} ${player.name}`;const score=document.createElement("strong");score.textContent=player.score;row.append(place,score);list.append(row)});
    const buttons=document.createElement("div");buttons.className="result-actions";
    const leave=document.createElement("button");leave.type="button";leave.className="button button--secondary";leave.textContent="Leave table";leave.addEventListener("click",onLeave);buttons.append(leave);
    if(me?.is_host){const close=document.createElement("button");close.type="button";close.className="button result-close";close.textContent="Close table for everyone";close.addEventListener("click",onClose);buttons.append(close)}
    action.append(celebration,crown,title,subtitle,list,buttons);
  }
}

function renderHand(game,roomCode,onPlay){
  const hand=document.querySelector("#my-hand");hand.replaceChildren();
  const cards=(game.hand||[]).map(parseCard).sort((a,b)=>SUIT_ORDER[a.suit]-SUIT_ORDER[b.suit]||RANK_ORDER[a.rank]-RANK_ORDER[b.rank]);
  const animationKey=`${roomCode}:${game.handIndex}`;const animateDeal=lastAnimatedHandKey!==animationKey&&cards.length>0;let dealtIndex=0;
  const rowSize=cards.length>6?Math.ceil(cards.length/2):cards.length||1;
  for(let start=0;start<cards.length;start+=rowSize){
    const row=document.createElement("div");row.className="card-row";const rowCards=cards.slice(start,start+rowSize);const midpoint=(rowCards.length-1)/2;
    rowCards.forEach((card,index)=>{
      const playable=legalCard(game,card);
      const button=cardElement(card,{disabled:!playable,selected:selectedCard===card.value,onClick:()=>{if(selectedCard===card.value){selectedCard=null;onPlay(card.value);return}selectedCard=card.value;hand.querySelectorAll(".playing-card--selected").forEach(item=>item.classList.remove("playing-card--selected"));button.classList.add("playing-card--selected")}});
      const distance=index-midpoint;button.style.setProperty("--fan-angle",`${distance*3.1}deg`);button.style.setProperty("--fan-drop",`${Math.abs(distance)*1.8}px`);
      if(animateDeal){button.classList.add("playing-card--dealt");button.style.setProperty("--deal-delay",`${dealtIndex*70}ms`);dealtIndex+=1}button.style.zIndex=index+1;row.append(button);
    });hand.append(row);
  }
  if(animateDeal)lastAnimatedHandKey=animationKey;
  document.querySelector("#hand-help").textContent=game.turnSeat===game.mySeat&&game.phase==="playing"?"Tap once to select · again to play":`${cards.length} card${cards.length===1?"":"s"}`;
}

function renderPrivateTricks(game){
  const myTricks=(game.myWonTricks||[]).filter(trick=>trick.handIndex===game.handIndex);
  document.querySelector("#my-tricks-count").textContent=myTricks.length;
  const wrap=document.querySelector("#my-tricks");wrap.replaceChildren();
  if(!myTricks.length){const empty=document.createElement("p");empty.className="empty-tricks";empty.textContent="You have not won a trick this hand.";wrap.append(empty)}
  for(const wonTrick of myTricks.slice().reverse()){
    const item=document.createElement("article");item.className="won-trick";const title=document.createElement("strong");title.textContent=`Trick ${wonTrick.trickNumber+1}`;const cards=document.createElement("div");cards.className="won-trick__cards";(wonTrick.plays||[]).forEach(play=>cards.append(cardElement(parseCard(play.card),{small:true,disabled:true})));item.append(title,cards);wrap.append(item);
  }
}

function renderTally(game,players){
  const ordered=players.slice().sort((a,b)=>a.seat-b.seat);const tally=document.querySelector("#tally-table");
  const headings=ordered.map(player=>`<th class="player-group" colspan="3">${escapeHtml(player.display_name)}</th>`).join("");
  const subheads=ordered.map(()=>"<th class=\"player-start\">B</th><th>W</th><th>Pts</th>").join("");
  const runningTotals=[0,0,0,0];const rows=(game.history||[]).map(row=>{for(let seat=0;seat<4;seat+=1)runningTotals[seat]+=row.scores[seat];return `<tr><td>${row.handSize}</td>${ordered.map(player=>`<td class="player-start">${row.bids[player.seat]}</td><td>${row.won[player.seat]}</td><td>${runningTotals[player.seat]>=0?"+":""}${runningTotals[player.seat]}</td>`).join("")}</tr>`}).join("");
  const totals=ordered.map(player=>`<td class="player-start" colspan="3"><strong>${game.totals[player.seat]}</strong></td>`).join("");
  tally.innerHTML=`<table><thead><tr><th>Cards</th>${headings}</tr><tr><th></th>${subheads}</tr></thead><tbody>${rows||`<tr><td colspan="13">No completed hands yet</td></tr>`}</tbody><tfoot><tr><td>Total</td>${totals}</tr></tfoot></table>`;
}

export function renderGame({game,players,roomCode,onBid,onPlay,onNextHand,onLeave,onClose}){
  if(lastRevision!==game.revision){selectedBid=null;selectedCard=null;lastRevision=game.revision}
  const bySeat=Object.fromEntries(players.map(player=>[player.seat,player]));const me=bySeat[game.mySeat];
  document.querySelector("#game-room-code").textContent=roomCode;
  document.querySelector("#game-hand-title").textContent=`Hand ${game.handIndex+1} of 22 · ${game.handSize} cards`;
  document.querySelector("#game-dealer").textContent=`Dealer: ${bySeat[game.dealerSeat]?.display_name||"—"}`;
  const trump=document.querySelector("#game-trump");trump.replaceChildren();const label=document.createElement("span");label.textContent="Trump";trump.append(label);if(game.trumpCard)trump.append(cardElement(parseCard(game.trumpCard),{small:true,disabled:true}));
  renderSeats(game,players,bySeat);renderTableCards(game);renderAction(game,bySeat,me,onBid,onNextHand,onLeave,onClose);renderHand(game,roomCode,onPlay);renderPrivateTricks(game);renderTally(game,players);
}
