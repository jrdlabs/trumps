import { ensureAnonymousSession } from "./supabase.js";
import { continueGame, createRoom, getGame, getLobby, getMyTables, joinRoom, kickPlayer, leaveRoom, nextHand, normalizeRoomCode, playCard, startGame, submitBid, subscribeToLobby, touchPresence } from "./lobby.js";
import { renderGame } from "./game-ui.js";
import { friendlyError, renderLobby, renderTables, setBusy, showToast, showView } from "./ui.js";

let session;
let currentRoom;
let unsubscribeLobby;
let presenceTimer;
let installPrompt;
let gameActionBusy = false;

const createForm = document.querySelector("#create-form");
const joinForm = document.querySelector("#join-form");
const joinCode = document.querySelector("#join-code");
const connectionBadge = document.querySelector("#connection-badge");

async function refreshLobby() {
  if (!currentRoom) return;
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
        onContinue: () => runGameAction(() => continueGame(currentRoom.id)),
        onNextHand: () => runGameAction(() => nextHand(currentRoom.id)),
        onRestart: () => runGameAction(() => startGame(currentRoom.id)),
      });
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
  }
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

async function showDashboard() {
  unsubscribeLobby?.();
  clearInterval(presenceTimer);
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

document.querySelector("#game-tab").addEventListener("click", () => {
  document.querySelector("#table-panel").hidden = false;
  document.querySelector("#tally-panel").hidden = true;
  document.querySelector("#game-tab").classList.add("game-tab--active");
  document.querySelector("#tally-tab").classList.remove("game-tab--active");
});

document.querySelector("#tally-tab").addEventListener("click", () => {
  document.querySelector("#table-panel").hidden = true;
  document.querySelector("#tally-panel").hidden = false;
  document.querySelector("#game-tab").classList.remove("game-tab--active");
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
