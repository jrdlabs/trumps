const views = ["loading", "home", "lobby"];
let toastTimer;

export function showView(name) {
  views.forEach((view) => {
    document.querySelector(`#${view}-view`).hidden = view !== name;
  });
}

export function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
}

export function setBusy(form, busy) {
  form.querySelectorAll("input, button").forEach((element) => { element.disabled = busy; });
}

export function friendlyError(error) {
  const message = error?.message || "Something went wrong. Please try again.";
  if (/anonymous sign-ins/i.test(message)) return "Anonymous sign-in must be enabled in Supabase first.";
  return message.replace(/^.*?error:\s*/i, "");
}

export function renderLobby({ room, players, currentUserId }) {
  document.querySelector("#room-code").textContent = room.code;
  document.querySelector("#room-code-large").textContent = room.code;
  const list = document.querySelector("#player-list");
  list.replaceChildren();

  for (let seat = 0; seat < 4; seat += 1) {
    const player = players.find((item) => item.seat === seat);
    const row = document.createElement("div");
    row.className = `player${player ? "" : " player--empty"}`;
    const seatBadge = document.createElement("span");
    seatBadge.className = "player__seat";
    seatBadge.textContent = seat + 1;
    const name = document.createElement("span");
    name.className = "player__name";
    name.textContent = player ? `${player.display_name}${player.user_id === currentUserId ? " (You)" : ""}` : "Waiting for player…";
    row.append(seatBadge, name);
    if (player?.is_host) {
      const tag = document.createElement("span");
      tag.className = "player__tag";
      tag.textContent = "Host";
      row.append(tag);
    }
    list.append(row);
  }

  const me = players.find((player) => player.user_id === currentUserId);
  const ready = players.length === 4;
  const startButton = document.querySelector("#start-game");
  startButton.hidden = !me?.is_host;
  startButton.disabled = !ready;
  document.querySelector("#lobby-help").textContent = ready
    ? me?.is_host ? "Everyone is here. You can start the game." : "Everyone is here. Waiting for the host to start."
    : `${players.length} of 4 players seated.`;
}

