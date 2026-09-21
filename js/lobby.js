import { supabase } from "./supabase.js";

const CURRENT_ROOM_KEY = "trumps.currentRoom";

export function normalizeRoomCode(value) {
  return value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 5);
}

export function readRememberedRoom() {
  try { return JSON.parse(localStorage.getItem(CURRENT_ROOM_KEY)); }
  catch { return null; }
}

export function rememberRoom(room) {
  localStorage.setItem(CURRENT_ROOM_KEY, JSON.stringify(room));
}

export function forgetRoom() {
  localStorage.removeItem(CURRENT_ROOM_KEY);
}

export async function createRoom(displayName) {
  const { data, error } = await supabase.rpc("trumps_create_room", { p_display_name: displayName.trim() }).single();
  if (error) throw error;
  const room = { id: data.room_id, code: data.room_code, seat: data.seat };
  rememberRoom(room);
  return room;
}

export async function joinRoom(roomCode, displayName) {
  const { data, error } = await supabase.rpc("trumps_join_room", {
    p_room_code: normalizeRoomCode(roomCode),
    p_display_name: displayName.trim(),
  }).single();
  if (error) throw error;
  const room = { id: data.room_id, code: data.room_code, seat: data.seat };
  rememberRoom(room);
  return room;
}

export async function getLobby(roomId) {
  const [roomResult, playersResult] = await Promise.all([
    supabase.from("trumps_rooms").select("id, code, status, host_user_id").eq("id", roomId).single(),
    supabase.from("trumps_players").select("id, user_id, display_name, seat, is_host").eq("room_id", roomId).order("seat"),
  ]);
  if (roomResult.error) throw roomResult.error;
  if (playersResult.error) throw playersResult.error;
  return { room: roomResult.data, players: playersResult.data };
}

export async function leaveRoom(roomId) {
  const { error } = await supabase.rpc("trumps_leave_room", { p_room_id: roomId });
  if (error) throw error;
  forgetRoom();
}

export function subscribeToLobby(roomId, onChange, onStatus) {
  const channel = supabase
    .channel(`trumps-lobby-${roomId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "trumps_players", filter: `room_id=eq.${roomId}` }, onChange)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "trumps_rooms", filter: `id=eq.${roomId}` }, onChange)
    .subscribe(onStatus);

  return () => supabase.removeChannel(channel);
}

