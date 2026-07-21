// Ticket-style room codes: 8 chars from an alphabet that excludes
// visually ambiguous characters (0/O, 1/I/L), formatted as XXXX-XXXX.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const ACCESS_KEY_LENGTH = 16;

export function generateRoomCode(): string {
  let raw = "";
  for (let i = 0; i < 8; i++) {
    raw += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function generateRoomAccessKey(): string {
  let key = "";
  for (let i = 0; i < ACCESS_KEY_LENGTH; i++) {
    key += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return key;
}

// Normalizes user-typed codes: uppercases, strips invalid chars,
// re-inserts the dash. Accepts input with or without the dash.
export function normalizeRoomCode(input: string): string {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, "");

  // Map common look-alikes back onto the safe alphabet so a mistyped
  // 0/O or 1/I/L still resolves to the intended code.
  const fixed = cleaned
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .slice(0, 8);

  if (fixed.length <= 4) return fixed;
  return `${fixed.slice(0, 4)}-${fixed.slice(4, 8)}`;
}

export function normalizeRoomAccessKey(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, ACCESS_KEY_LENGTH);
}

export function isValidRoomCode(code: string): boolean {
  return /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/.test(
    code
  );
}

export function isValidRoomAccessKey(key: string): boolean {
  return new RegExp(`^[${ALPHABET}]{${ACCESS_KEY_LENGTH}}$`).test(key);
}

type ParsedTicket = {
  code: string;
  key: string | null;
};

export function parseTicketInput(input: string): ParsedTicket {
  const trimmed = input.trim();
  if (!trimmed) return { code: "", key: null };

  let asUrl: URL | null = null;
  try {
    asUrl = new URL(trimmed);
  } catch {
    asUrl = null;
  }

  if (asUrl) {
    const pathParts = asUrl.pathname.split("/").filter(Boolean);
    const maybeCode = pathParts[pathParts.length - 1] || "";
    const code = normalizeRoomCode(maybeCode);
    const hash = asUrl.hash.startsWith("#") ? asUrl.hash.slice(1) : asUrl.hash;
    const hashParams = new URLSearchParams(hash);
    const keyFromK = hashParams.get("k") || hashParams.get("K") || "";
    const key = normalizeRoomAccessKey(keyFromK);
    return { code, key: key || null };
  }

  const keyMatch = trimmed.match(/#k=([A-Za-z0-9]+)/i);
  const rawKey = keyMatch?.[1] || "";
  const rawCode = keyMatch ? trimmed.slice(0, keyMatch.index) : trimmed;
  return {
    code: normalizeRoomCode(rawCode || ""),
    key: rawKey ? normalizeRoomAccessKey(rawKey) : null,
  };
}

export function buildRoomLink(origin: string, code: string, key: string): string {
  return `${origin}/r/${code}#k=${key}`;
}
