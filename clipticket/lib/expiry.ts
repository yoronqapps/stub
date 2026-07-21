export type ExpiryOption = {
  label: string;
  hours: number;
};

export const EXPIRY_OPTIONS: ExpiryOption[] = [
  { label: "1 hour", hours: 1 },
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 24 * 7 },
  { label: "30 days", hours: 24 * 30 },
];

export const DEFAULT_EXPIRY_HOURS = 24 * 7;

export function expiryFromNow(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

export function formatTimeLeft(expiresAtISO: string | null): string {
  if (!expiresAtISO) return "never expires";
  const ms = new Date(expiresAtISO).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 1) {
    const mins = Math.max(1, Math.floor(ms / (60 * 1000)));
    return `expires in ${mins}m`;
  }
  if (hours < 48) return `expires in ${hours}h`;
  const days = Math.floor(hours / 24);
  return `expires in ${days}d`;
}
