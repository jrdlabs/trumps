import { ensureAnonymousSession } from "./supabase.js";
import { createRoom, forgetRoom, getLobby, joinRoom, leaveRoom, normalizeRoomCode, readRememberedRoom, subscribeToLobby } from "./lobby.js";
import { friendlyError, renderLobby, setBusy, showToast, showView } from "./ui.js";

let session;
let currentRoom;
let unsubscribeLobby;

const createForm = document.querySelector("#create-form");
const joinForm = document.querySelector("#join-form");
const joinCode = document.querySelector("#join-code");
const connectionBadge = document.querySelector("#connection-badge");

async function refreshLobby() {
  if (!currentRoom) return;
  try {
    const lobby = await getLobby(currentRoom.id);
    renderLobby({ ...lobby, currentUserId: session.user.id });
  } catch (error) {
    forgetRoom();
    currentRoom = null;
    showView("home");
    showToast(friendlyError(error));
  }
}

async function enterLobby(room) {
  currentRoom = room;
  showView("lobby");
  await refreshLobby();
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

    const remembered = readRememberedRoom();
    if (remembered?.id) await enterLobby(remembered);
    else showView("home");
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
  currentRoom = null;
  history.replaceState(null, "", location.pathname);
  showView("home");
});

document.querySelector("#start-game").addEventListener("click", () => {
  showToast("Game start is the next build milestone.");
});

initialize();

