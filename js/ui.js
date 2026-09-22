const views = ["loading", "home", "lobby", "game"];
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

export function renderTables(tables, onOpen) {
  const section = document.querySelector("#tables-section");
  const list = document.querySelector("#table-list");
  section.hidden = tables.length === 0;
  document.querySelector("#table-count").textContent = tables.length;
  list.replaceChildren();
  tables.forEach((table) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "table-card";
    const role = table.membership.is_host ? "Host" : `Seat ${table.membership.seat + 1}`;
    button.innerHTML = `<span class="table-card__code"></span><span class="table-card__details"><strong></strong><small></small></span><span class="table-card__arrow">›</span>`;
    button.querySelector(".table-card__code").textContent = table.code;
    button.querySelector("strong").textContent = `${table.playerCount} of 4 players`;
    button.querySelector("small").textContent = `${role} · ${table.status}`;
    button.addEventListener("click", () => onOpen(table));
    list.append(button);
  });
}

export function renderLobby({ room, players, currentUserId, onKick }) {
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
    if (player) {
      const status = document.createElement("span");
      const online = Date.now() - new Date(player.last_seen_at).getTime() < 50000;
      status.className = `player__status${online ? " player__status--online" : ""}`;
      status.title = online ? "Online" : "Offline";
      row.append(status);
    }
    if (player?.is_host) {
      const tag = document.createElement("span");
      tag.className = "player__tag";
      tag.textContent = "Host";
      row.append(tag);
    }
    const me = players.find((item) => item.user_id === currentUserId);
    if (me?.is_host && player && player.user_id !== currentUserId) {
      const kick = document.createElement("button");
      kick.type = "button";
      kick.className = "player__kick";
      kick.textContent = "Remove";
      kick.addEventListener("click", () => onKick(player));
      row.append(kick);
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
