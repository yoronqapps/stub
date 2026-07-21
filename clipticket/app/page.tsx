"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  buildRoomLink,
  generateRoomAccessKey,
  generateRoomCode,
  isValidRoomAccessKey,
  isValidRoomCode,
  parseTicketInput,
} from "@/lib/roomCode";

export default function LandingPage() {
  const router = useRouter();
  const [joinInput, setJoinInput] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);

  function handleNewTicket() {
    const code = generateRoomCode();
    const key = generateRoomAccessKey();
    const url = buildRoomLink(window.location.origin, code, key);
    router.push(url.replace(window.location.origin, ""));
  }

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const { code, key } = parseTicketInput(joinInput);
    if (!isValidRoomCode(code) || !key || !isValidRoomAccessKey(key)) {
      setJoinError("Paste the full ticket link (including #k=...) to open this clipboard securely.");
      return;
    }
    router.push(`/r/${code}#k=${key}`);
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-brass/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="mb-10 text-center">
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.3em] text-brass">
            Clipticket
          </p>
          <h1 className="font-sans text-3xl font-semibold leading-tight text-paper sm:text-4xl">
            Drop it here.
            <br />
            Claim it anywhere.
          </h1>
          <p className="mx-auto mt-4 max-w-sm text-sm leading-relaxed text-fog">
            Copy text or a file, get a ticket number, then pull it up on any
            other device. No account, no app install, nothing to remember
            but eight characters.
          </p>
        </div>

        {/* The ticket */}
        <div className="ticket-card shadow-ticket rounded-2xl">
          <div className="flex items-center justify-between px-6 py-5">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/50">
                Coat check
              </p>
              <p className="font-sans text-lg font-semibold">New clipboard</p>
            </div>
            <div className="stamp-ring flex h-12 w-12 items-center justify-center text-stamp">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="12" cy="12" r="9" />
              </svg>
            </div>
          </div>

          <button
            onClick={handleNewTicket}
            className="mx-6 mb-6 flex w-[calc(100%-3rem)] items-center justify-center gap-2 rounded-lg bg-ink px-5 py-4 font-mono text-sm font-semibold uppercase tracking-widest text-paper transition hover:bg-stamp active:scale-[0.99]"
          >
            Take a ticket
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <div className="perforation" />

          <form onSubmit={handleJoin} className="px-6 py-6">
            <label htmlFor="join" className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/50">
              Have a ticket already?
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="join"
                value={joinInput}
                onChange={(e) => {
                  setJoinInput(e.target.value);
                  setJoinError(null);
                }}
                placeholder="Paste full ticket link"
                maxLength={500}
                className="w-full rounded-md border border-ink/15 bg-white/40 px-3 py-2.5 font-mono text-sm uppercase tracking-widest text-ink placeholder:text-ink/30 focus:border-stamp focus:bg-white/70 focus:outline-none"
              />
              <button
                type="submit"
                className="shrink-0 rounded-md border border-ink/20 bg-transparent px-4 py-2.5 font-mono text-xs font-semibold uppercase tracking-widest text-ink transition hover:border-stamp hover:text-stamp"
              >
                Claim
              </button>
            </div>
            {joinError && (
              <p className="mt-2 font-mono text-xs text-rust">{joinError}</p>
            )}
          </form>
        </div>

        <p className="mt-8 text-center font-mono text-[11px] leading-relaxed text-fog/70">
          Security mode is on: access now requires the full ticket link,
          including its hidden room key fragment.
        </p>
      </div>
    </main>
  );
}
