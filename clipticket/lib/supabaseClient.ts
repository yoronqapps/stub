import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  // Fails loudly in dev if env vars are missing, rather than a silent
  // "fetch failed" deep inside a component.
  // eslint-disable-next-line no-console
  console.warn(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
      "Copy .env.example to .env.local and fill in your Supabase project values."
  );
}

type RoomHeaderInput = {
  roomCode?: string;
  roomKey?: string;
};

export function createSupabaseClient(headers?: RoomHeaderInput) {
  const globalHeaders: Record<string, string> = {};

  if (headers?.roomCode) {
    globalHeaders["x-room-code"] = headers.roomCode;
  }
  if (headers?.roomKey) {
    globalHeaders["x-room-key"] = headers.roomKey;
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: globalHeaders,
    },
  });
}

export const FILES_BUCKET = "clipticket-files";
export const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100MB, see README for why
