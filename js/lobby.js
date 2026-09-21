import { supabase } from "./supabase.js";

export function normalizeRoomCode(value) {
  return value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 5);
}

export async function createRoom(displayName) {
  const { data, error } = await supabase.rpc("trumps_create_room", { p_display_name: displayName.trim() }).single();
  if (error) throw error;
  const room = { id: data.room_id, code: data.room_code, seat: data.seat };
  return room;
}

export async function joinRoom(roomCode, displayName) {
  const { data, error } = await supabase.rpc("trumps_join_room", {
    p_room_code: normalizeRoomCode(roomCode),
    p_display_name: displayName.trim(),
  }).single();
  if (error) throw error;
  const room = { id: data.room_id, code: data.room_code, seat: data.seat };
  return room;
}

export async function getMyTables(userId) {
  const memberships = await supabase
    .from("trumps_players")
    .select("room_id, display_name, seat, is_host")
    .eq("user_id", userId)
    .order("joined_at", { ascending: false });
  if (memberships.error) throw memberships.error;
  if (!memberships.data.length) return [];

  const roomIds = memberships.data.map((item) => item.room_id);
  const [roomsResult, playersResult] = await Promise.all([
    supabase.from("trumps_rooms").select("id, code, status, updated_at").in("id", roomIds),
    supabase.from("trumps_players").select("room_id").in("room_id", roomIds),
  ]);
  if (roomsResult.error) throw roomsResult.error;
  if (playersResult.error) throw playersResult.error;

  return roomsResult.data.map((room) => ({
    ...room,
    membership: memberships.data.find((item) => item.room_id === room.id),
    playerCount: playersResult.data.filter((item) => item.room_id === room.id).length,
  }));
}

export async function getLobby(roomId) {
  const [roomResult, playersResult] = await Promise.all([
    supabase.from("trumps_rooms").select("id, code, status, host_user_id").eq("id", roomId).single(),
    supabase.from("trumps_players").select("id, user_id, display_name, seat, is_host, last_seen_at").eq("room_id", roomId).order("seat"),
  ]);
  if (roomResult.error) throw roomResult.error;
  if (playersResult.error) throw playersResult.error;
  return { room: roomResult.data, players: playersResult.data };
}

export async function leaveRoom(roomId) {
  const { error } = await supabase.rpc("trumps_leave_room", { p_room_id: roomId });
  if (error) throw error;
}

export async function touchPresence(roomId) {
  const { error } = await supabase.rpc("trumps_touch_presence", { p_room_id: roomId });
  if (error) throw error;
}

export async function kickPlayer(roomId, playerId) {
  const { error } = await supabase.rpc("trumps_kick_player", { p_room_id: roomId, p_player_id: playerId });
  if (error) throw error;
}

export function subscribeToLobby(roomId, onChange, onStatus) {
  const channel = supabase
    .channel(`trumps-lobby-${roomId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "trumps_players", filter: `room_id=eq.${roomId}` }, onChange)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "trumps_rooms", filter: `id=eq.${roomId}` }, onChange)
    .subscribe(onStatus);

  return () => supabase.removeChannel(channel);
}
