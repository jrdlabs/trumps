import { ensureAnonymousSession } from "./supabase.js";
import { closeCompletedRoom, continueGame, createRoom, getAdminHistory, getGame, getLobby, getMyTables, joinRoom, kickPlayer, leaveRoom, nextHand, normalizeRoomCode, playCard, startGame, submitBid, subscribeToLobby, touchPresence } from "./lobby.js";
import { renderGame } from "./game-ui.js";
import { friendlyError, renderLobby, renderTables, setBusy, showToast, showView } from "./ui.js";

let session;
let currentRoom;
let unsubscribeLobby;
let presenceTimer;
let stateTimer;
let installPrompt;
let gameActionBusy = false;
let refreshInFlight = false;
let autoAdvanceTimer;
let scheduledTrickRevision;

const createForm = document.querySelector("#create-form");
const joinForm = document.querySelector("#join-form");
const joinCode = document.querySelector("#join-code");
const connectionBadge = document.querySelector("#connection-badge");

const formatDate = value => new Intl.DateTimeFormat("en-JM", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const formatDuration = seconds => `${Math.floor(seconds / 60)}m ${seconds % 60}s`;

function renderHistory(data) {
  const stats = [
    ["Completed games", data.summary.completedGames],
    ["Games started", data.summary.gamesStarted],
    ["Rooms created", data.summary.roomsCreated],
    ["Player joins", data.summary.playerJoins],
  ];
  const statsWrap = document.querySelector("#history-stats");
  statsWrap.replaceChildren(...stats.map(([label, value]) => {
    const item = document.createElement("div"); item.className = "history-stat";
    const number = document.createElement("strong"); number.textContent = value;
    const caption = document.createElement("span"); caption.textContent = label;
    item.append(number, caption); return item;
  }));
  document.querySelector("#history-count").textContent = `${data.games.length} archived`;
  const games = document.querySelector("#history-games"); games.replaceChildren();
  if (!data.games.length) {
    const empty = document.createElement("p"); empty.className = "history-empty";
    empty.textContent = "Completed games will appear here."; games.append(empty); return;
  }
  data.games.forEach(game => {
    const details = document.createElement("details"); details.className = "history-game";
    const summary = document.createElement("summary");
    const top = document.createElement("div"); top.className = "history-game__top";
    const room = document.createElement("strong"); room.textContent = `Room ${game.roomCode}`;
    const when = document.createElement("small"); when.textContent = formatDate(game.completedAt);
    top.append(room, when);
    const winner = document.createElement("span"); winner.className = "history-winner";
    winner.textContent = `🏆 ${game.winnerNames.join(" & ")} · ${game.winningScore} points`;
    summary.append(top, winner);
    const body = document.createElement("div"); body.className = "history-game__body";
    const meta = document.createElement("p"); meta.className = "muted";
    meta.textContent = `Game ${game.gameNumber} · ${formatDuration(game.durationSeconds)} · ${game.hands.length} hands`;
    const players = document.createElement("div"); players.className = "history-players";
    [...game.players].sort((a,b)=>b.score-a.score).forEach((player,index) => {
      const row = document.createElement("div"); row.className = "history-player";
      const name = document.createElement("span"); name.textContent = `${index+1}. ${player.name}`;
      const score = document.createElement("strong"); score.textContent = player.score;
      row.append(name,score); players.append(row);
    });
    const table = document.createElement("table"); table.className = "history-hands";
    const names = [...game.players].sort((a,b)=>a.seat-b.seat);
    const head = document.createElement("thead"); const hr = document.createElement("tr");
    ["Cards", ...names.map(player=>player.name)].forEach(label=>{const th=document.createElement("th");th.textContent=label;hr.append(th)});head.append(hr);
    const tbody = document.createElement("tbody");
    game.hands.forEach(hand=>{const tr=document.createElement("tr");const size=document.createElement("td");size.textContent=hand.handSize;tr.append(size);names.forEach(player=>{const td=document.createElement("td");td.textContent=`${hand.scores[player.seat]>=0?"+":""}${hand.scores[player.seat]}`;tr.append(td)});tbody.append(tr)});
    table.append(head,tbody); body.append(meta,players,table); details.append(summary,body); games.append(details);
  });
}

async function refreshLobby() {
  if (!currentRoom || refreshInFlight) return;
  refreshInFlight = true;
  try {
    const lobby = await getLobby(currentRoom.id);
    if (lobby.room.status === "playing") {
      const game = await getGame(currentRoom.id);
      showView("game");
      renderGame({
        game,
        players: lobby.players,
        roomCode: lobby.room.code,
        onBid: (bid) => runGameAction(() => submitBid(currentRoom.id, bid)),
        onPlay: (card) => runGameAction(() => playCard(currentRoom.id, card)),
        onNextHand: () => runGameAction(() => nextHand(currentRoom.id)),
        onLeave: () => exitCompletedTable(false),
        onClose: () => exitCompletedTable(true),
      });
      scheduleAutomaticAdvance(game);
      return;
    }
    showView("lobby");
    renderLobby({
      ...lobby,
      currentUserId: session.user.id,
      onKick: async (player) => {
        if (!confirm(`Remove ${player.display_name} from this table?`)) return;
        try { await kickPlayer(currentRoom.id, player.id); }
        catch (error) { showToast(friendlyError(error)); }
      },
    });
  } catch (error) {
    currentRoom = null;
    await showDashboard();
    showToast(friendlyError(error));
  } finally {
    refreshInFlight = false;
  }
}

function scheduleAutomaticAdvance(game) {
  if (game.phase !== "trick_complete") {
    clearTimeout(autoAdvanceTimer);
    scheduledTrickRevision = null;
    return;
  }
  if (scheduledTrickRevision === game.revision) return;
  clearTimeout(autoAdvanceTimer);
  scheduledTrickRevision = game.revision;
  const completedAt = Date.parse(game.trickCompletedAt || "");
  const delay = Number.isFinite(completedAt) ? Math.max(0, completedAt + 6200 - Date.now()) : 5000;
  autoAdvanceTimer = setTimeout(async () => {
    if (!currentRoom || scheduledTrickRevision !== game.revision) return;
    try { await continueGame(currentRoom.id); }
    catch { /* Another connected player may have advanced the same trick first. */ }
    await refreshLobby();
  }, delay + 80);
}

async function runGameAction(action) {
  if (gameActionBusy) return;
  gameActionBusy = true;
  try {
    await action();
    await refreshLobby();
  } catch (error) {
    showToast(friendlyError(error));
  } finally {
    gameActionBusy = false;
  }
}

async function exitCompletedTable(closeTable) {
  if (closeTable && !confirm("Close this table for everyone? The completed result will remain in game history.")) return;
  try {
    if (closeTable) await closeCompletedRoom(currentRoom.id);
    else await leaveRoom(currentRoom.id);
    await showDashboard();
    showToast(closeTable ? "Table closed. Result archived." : "You left the completed table.");
  } catch (error) { showToast(friendlyError(error)); }
}

async function showDashboard() {
  unsubscribeLobby?.();
  clearInterval(presenceTimer);
  clearInterval(stateTimer);
  clearTimeout(autoAdvanceTimer);
  currentRoom = null;
  history.replaceState(null, "", location.pathname);
  const tables = await getMyTables(session.user.id);
  renderTables(tables, (table) => enterLobby({ id: table.id, code: table.code, seat: table.membership.seat }));
  showView("home");
}

async function enterLobby(room) {
  currentRoom = room;
  showView("lobby");
  await refreshLobby();
  await touchPresence(room.id);
  clearInterval(presenceTimer);
  presenceTimer = setInterval(async () => {
    try { await touchPresence(room.id); }
    catch {
      clearInterval(presenceTimer);
      await showDashboard();
      showToast("You are no longer seated at that table.");
    }
  }, 25000);
  clearInterval(stateTimer);
  stateTimer = setInterval(refreshLobby, 1500);
  unsubscribeLobby?.();
  unsubscribeLobby = subscribeToLobby(
    room.id,
    refreshLobby,
    (status) => {
      const live = status === "SUBSCRIBED";
      connectionBadge.textContent = live ? "Live" : "Connecting";
      connectionBadge.classList.toggle("badge--live", live);
    },
  );
  history.replaceState(null, "", `${location.pathname}?room=${room.code}`);
}

async function initialize() {
  try {
    session = await ensureAnonymousSession();
    const params = new URLSearchParams(location.search);
    const inviteCode = normalizeRoomCode(params.get("room") || "");
    if (inviteCode) joinCode.value = inviteCode;

    const tables = await getMyTables(session.user.id);
    const existing = inviteCode ? tables.find((table) => table.code === inviteCode) : null;
    if (existing) await enterLobby({ id: existing.id, code: existing.code, seat: existing.membership.seat });
    else {
      renderTables(tables, (table) => enterLobby({ id: table.id, code: table.code, seat: table.membership.seat }));
      showView("home");
    }
  } catch (error) {
    showView("home");
    showToast(friendlyError(error));
  }
}

joinCode.addEventListener("input", () => { joinCode.value = normalizeRoomCode(joinCode.value); });

createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const displayName = new FormData(createForm).get("displayName");
  setBusy(createForm, true);
  try { await enterLobby(await createRoom(displayName)); }
  catch (error) { showToast(friendlyError(error)); }
  finally { setBusy(createForm, false); }
});

joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(joinForm);
  const roomCode = form.get("roomCode");
  const displayName = form.get("displayName");
  setBusy(joinForm, true);
  try { await enterLobby(await joinRoom(roomCode, displayName)); }
  catch (error) { showToast(friendlyError(error)); }
  finally { setBusy(joinForm, false); }
});

document.querySelector("#copy-invite").addEventListener("click", async () => {
  const inviteUrl = `${location.origin}${location.pathname}?room=${currentRoom.code}`;
  await navigator.clipboard.writeText(inviteUrl);
  showToast("Invite link copied");
});

document.querySelector("#leave-room").addEventListener("click", async () => {
  try { await leaveRoom(currentRoom.id); }
  catch (error) { showToast(friendlyError(error)); return; }
  unsubscribeLobby?.();
  clearInterval(presenceTimer);
  currentRoom = null;
  await showDashboard();
});

document.querySelector("#back-to-tables").addEventListener("click", showDashboard);

document.querySelector("#start-game").addEventListener("click", () => runGameAction(() => startGame(currentRoom.id)));
document.querySelector("#game-back").addEventListener("click", showDashboard);

document.querySelector("#open-history").addEventListener("click", () => {
  document.querySelector("#history-login").hidden = false;
  document.querySelector("#history-content").hidden = true;
  showView("history");
});
document.querySelector("#history-back").addEventListener("click", showDashboard);
document.querySelector("#history-login").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const accessKey = new FormData(form).get("accessKey");
  setBusy(form, true);
  try {
    renderHistory(await getAdminHistory(accessKey));
    form.hidden = true;
    document.querySelector("#history-content").hidden = false;
    form.reset();
  } catch (error) { showToast(friendlyError(error)); }
  finally { setBusy(form, false); }
});

document.querySelector("#game-tab").addEventListener("click", () => {
  document.querySelector("#table-panel").hidden = false;
  document.querySelector("#tricks-panel").hidden = true;
  document.querySelector("#tally-panel").hidden = true;
  document.querySelector("#game-tab").classList.add("game-tab--active");
  document.querySelector("#tricks-tab").classList.remove("game-tab--active");
  document.querySelector("#tally-tab").classList.remove("game-tab--active");
});

document.querySelector("#tricks-tab").addEventListener("click", () => {
  document.querySelector("#table-panel").hidden = true;
  document.querySelector("#tricks-panel").hidden = false;
  document.querySelector("#tally-panel").hidden = true;
  document.querySelector("#game-tab").classList.remove("game-tab--active");
  document.querySelector("#tricks-tab").classList.add("game-tab--active");
  document.querySelector("#tally-tab").classList.remove("game-tab--active");
});

document.querySelector("#my-won-pile").addEventListener("click", () => {
  document.querySelector("#tricks-tab").click();
});

document.querySelector("#tally-tab").addEventListener("click", () => {
  document.querySelector("#table-panel").hidden = true;
  document.querySelector("#tricks-panel").hidden = true;
  document.querySelector("#tally-panel").hidden = false;
  document.querySelector("#game-tab").classList.remove("game-tab--active");
  document.querySelector("#tricks-tab").classList.remove("game-tab--active");
  document.querySelector("#tally-tab").classList.add("game-tab--active");
});

initialize();

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  document.querySelector("#install-app").hidden = false;
});

document.querySelector("#install-app").addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  document.querySelector("#install-app").hidden = true;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js"));
}
