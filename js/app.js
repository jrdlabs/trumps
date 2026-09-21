import { ensureAnonymousSession } from "./supabase.js";
import { createRoom, getLobby, getMyTables, joinRoom, kickPlayer, leaveRoom, normalizeRoomCode, subscribeToLobby, touchPresence } from "./lobby.js";
import { friendlyError, renderLobby, renderTables, setBusy, showToast, showView } from "./ui.js";

let session;
let currentRoom;
let unsubscribeLobby;
let presenceTimer;
let installPrompt;

const createForm = document.querySelector("#create-form");
const joinForm = document.querySelector("#join-form");
const joinCode = document.querySelector("#join-code");
const connectionBadge = document.querySelector("#connection-badge");

async function refreshLobby() {
  if (!currentRoom) return;
  try {
    const lobby = await getLobby(currentRoom.id);
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
  setBusy(createForm, true);
  try { await enterLobby(await createRoom(new FormData(createForm).get("displayName"))); }
  catch (error) { showToast(friendlyError(error)); }
  finally { setBusy(createForm, false); }
});

joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(joinForm, true);
  const form = new FormData(joinForm);
  try { await enterLobby(await joinRoom(form.get("roomCode"), form.get("displayName"))); }
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

document.querySelector("#start-game").addEventListener("click", () => {
  showToast("Game start is the next build milestone.");
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
