// Ticket-style room codes: 8 chars from an alphabet that excludes
// visually ambiguous characters (0/O, 1/I/L), formatted as XXXX-XXXX.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function generateRoomCode(): string {
  let raw = "";
  for (let i = 0; i < 8; i++) {
    raw += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
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

export function isValidRoomCode(code: string): boolean {
  return /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/.test(
    code
  );
}
