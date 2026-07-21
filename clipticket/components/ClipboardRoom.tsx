"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { supabase, FILES_BUCKET, MAX_FILE_BYTES } from "@/lib/supabaseClient";
import { normalizeRoomCode, isValidRoomCode } from "@/lib/roomCode";
import {
  EXPIRY_OPTIONS,
  DEFAULT_EXPIRY_HOURS,
  expiryFromNow,
  formatTimeLeft,
} from "@/lib/expiry";

type RoomRow = {
  code: string;
  text_content: string;
  updated_at: string;
  expires_at: string | null;
};

type FileRow = {
  id: string;
  room_code: string;
  file_name: string;
  storage_path: string;
  size_bytes: number;
  created_at: string;
};

type ConnState = "connecting" | "live" | "offline";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ClipboardRoom({ rawCode }: { rawCode: string }) {
  const code = normalizeRoomCode(decodeURIComponent(rawCode || ""));
  const valid = isValidRoomCode(code);

  const [loading, setLoading] = useState(true);
  const [room, setRoom] = useState<RoomRow | null>(null);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<FileRow[]>([]);
  const [conn, setConn] = useState<ConnState>("connecting");
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [dragOver, setDragOver] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const lastSentContent = useRef<string>("");
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ---- Bootstrap room + realtime subscription ----
  useEffect(() => {
    if (!valid) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    async function bootstrap() {
      const { data: existing, error: fetchErr } = await supabase
        .from("rooms")
        .select("*")
        .eq("code", code)
        .maybeSingle();

      if (fetchErr) {
        if (!cancelled) setErrorMsg("Couldn't reach the clipboard service. Check your connection and refresh.");
        setLoading(false);
        return;
      }

      let roomRow = existing as RoomRow | null;

      if (!roomRow) {
        const { data: created, error: insertErr } = await supabase
          .from("rooms")
          .insert({
            code,
            text_content: "",
            expires_at: expiryFromNow(DEFAULT_EXPIRY_HOURS),
          })
          .select()
          .single();

        if (insertErr) {
          if (!cancelled) setErrorMsg("Couldn't create this ticket. It may already be in use — try refreshing.");
          setLoading(false);
          return;
        }
        roomRow = created as RoomRow;
      }

      if (cancelled) return;
      setRoom(roomRow);
      setText(roomRow.text_content || "");
      lastSentContent.current = roomRow.text_content || "";

      const { data: fileRows } = await supabase
        .from("room_files")
        .select("*")
        .eq("room_code", code)
        .order("created_at", { ascending: false });

      if (!cancelled && fileRows) setFiles(fileRows as FileRow[]);
      if (!cancelled) setLoading(false);
    }

    bootstrap();

    const channel = supabase
      .channel(`room-${code}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "rooms", filter: `code=eq.${code}` },
        (payload) => {
          const updated = payload.new as RoomRow;
          setRoom(updated);
          if (updated.text_content !== lastSentContent.current) {
            setText(updated.text_content || "");
            lastSentContent.current = updated.text_content || "";
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "room_files", filter: `room_code=eq.${code}` },
        (payload) => {
          const row = payload.new as FileRow;
          setFiles((prev) => (prev.some((f) => f.id === row.id) ? prev : [row, ...prev]));
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "room_files", filter: `room_code=eq.${code}` },
        (payload) => {
          const row = payload.old as FileRow;
          setFiles((prev) => prev.filter((f) => f.id !== row.id));
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setConn("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setConn("offline");
        }
      });

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [code, valid]);

  // ---- QR code for the room link ----
  useEffect(() => {
    if (!valid || typeof window === "undefined") return;
    const url = `${window.location.origin}/r/${code}`;
    QRCode.toDataURL(url, {
      margin: 1,
      width: 220,
      color: { dark: "#16181D", light: "#EDE4D000" },
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [code, valid]);

  // ---- Debounced text sync ----
  const handleTextChange = useCallback(
    (value: string) => {
      setText(value);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(async () => {
        lastSentContent.current = value;
        await supabase
          .from("rooms")
          .update({ text_content: value, updated_at: new Date().toISOString() })
          .eq("code", code);
      }, 500);
    },
    [code]
  );

  // ---- File upload ----
  async function uploadFiles(fileList: FileList | File[]) {
    setErrorMsg(null);
    for (const file of Array.from(fileList)) {
      if (file.size > MAX_FILE_BYTES) {
        setErrorMsg(`"${file.name}" is over the 100MB limit and wasn't uploaded.`);
        continue;
      }
      const tempKey = `${file.name}-${file.size}-${Date.now()}`;
      setUploading((prev) => ({ ...prev, [tempKey]: true }));
      const path = `${code}/${Date.now()}-${file.name}`;

      const { error: uploadErr } = await supabase.storage
        .from(FILES_BUCKET)
        .upload(path, file, { upsert: false });

      if (uploadErr) {
        setErrorMsg(`"${file.name}" failed to upload. Try again.`);
        setUploading((prev) => {
          const next = { ...prev };
          delete next[tempKey];
          return next;
        });
        continue;
      }

      await supabase.from("room_files").insert({
        room_code: code,
        file_name: file.name,
        storage_path: path,
        size_bytes: file.size,
      });

      setUploading((prev) => {
        const next = { ...prev };
        delete next[tempKey];
        return next;
      });
    }
  }

  async function handleDeleteFile(f: FileRow) {
    setFiles((prev) => prev.filter((x) => x.id !== f.id));
    await supabase.storage.from(FILES_BUCKET).remove([f.storage_path]);
    await supabase.from("room_files").delete().eq("id", f.id);
  }

  function getDownloadUrl(path: string): string {
    const { data } = supabase.storage.from(FILES_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }

  async function handleExpiryChange(hours: number) {
    const expires_at = expiryFromNow(hours);
    await supabase.from("rooms").update({ expires_at }).eq("code", code);
    setRoom((prev) => (prev ? { ...prev, expires_at } : prev));
  }

  function handleCopyLink() {
    const url = `${window.location.origin}/r/${code}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  // ---- Invalid code screen ----
  if (!valid) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <p className="mb-3 font-mono text-xs uppercase tracking-[0.3em] text-brass">Clipticket</p>
        <h1 className="mb-3 text-2xl font-semibold text-paper">That ticket isn't valid</h1>
        <p className="mb-8 max-w-sm text-sm text-fog">
          Ticket codes are 8 characters, formatted like XXXX-XXXX. Double-check
          what you typed, or take a fresh ticket.
        </p>
        <Link
          href="/"
          className="rounded-md bg-brass px-5 py-2.5 font-mono text-xs font-semibold uppercase tracking-widest text-ink hover:bg-brass-bright"
        >
          Back to the counter
        </Link>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-6">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-brass animate-pulse">
          Punching your ticket…
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-10 sm:px-6">
      {/* Header / ticket stub */}
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href="/" className="font-mono text-[10px] uppercase tracking-[0.3em] text-brass hover:text-brass-bright">
            ← Clipticket
          </Link>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold tracking-widest text-paper sm:text-3xl">
              {code}
            </h1>
            <span
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest ${
                conn === "live"
                  ? "border-stamp text-stamp-bright"
                  : conn === "connecting"
                  ? "border-ink-line text-fog"
                  : "border-rust text-rust"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  conn === "live" ? "bg-stamp-bright" : conn === "connecting" ? "bg-fog" : "bg-rust"
                }`}
              />
              {conn === "live" ? "connected" : conn === "connecting" ? "connecting" : "offline"}
            </span>
          </div>
          <p className="mt-1 font-mono text-xs text-fog">{formatTimeLeft(room?.expires_at ?? null)}</p>
        </div>

        <div className="flex items-center gap-3">
          {qrDataUrl && (
            <img
              src={qrDataUrl}
              alt="QR code linking to this clipboard"
              className="h-16 w-16 rounded-md bg-paper p-1"
            />
          )}
          <button
            onClick={handleCopyLink}
            className="rounded-md border border-ink-line px-4 py-2.5 font-mono text-xs font-semibold uppercase tracking-widest text-paper transition hover:border-brass hover:text-brass"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      </header>

      {errorMsg && (
        <div className="mb-6 rounded-md border border-rust/40 bg-rust/10 px-4 py-3 font-mono text-xs text-rust">
          {errorMsg}
        </div>
      )}

      {/* Text pad */}
      <section className="mb-6">
        <label htmlFor="clip-text" className="mb-2 block font-mono text-[10px] uppercase tracking-[0.25em] text-fog">
          Shared text
        </label>
        <textarea
          id="clip-text"
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          placeholder="Type or paste anything — it lands on every device with this ticket, instantly."
          className="h-56 w-full resize-y rounded-xl border border-ink-line bg-ink-soft px-4 py-3 font-mono text-sm leading-relaxed text-paper placeholder:text-fog/50 focus:border-brass focus:outline-none"
        />
      </section>

      {/* File drop zone */}
      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-fog">Files</span>
          <span className="font-mono text-[10px] text-fog/60">100MB max per file</span>
        </div>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`cursor-pointer rounded-xl border-2 border-dashed px-6 py-8 text-center transition ${
            dragOver ? "border-brass bg-brass/5" : "border-ink-line hover:border-fog"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) uploadFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <p className="font-mono text-xs text-fog">
            Drag files here, or <span className="text-brass">click to browse</span>
          </p>
        </div>

        {Object.keys(uploading).length > 0 && (
          <ul className="mt-3 space-y-1">
            {Object.keys(uploading).map((k) => (
              <li key={k} className="font-mono text-xs text-fog animate-pulse">
                Uploading {k.split("-")[0]}…
              </li>
            ))}
          </ul>
        )}

        {files.length > 0 && (
          <ul className="mt-4 divide-y divide-ink-line overflow-hidden rounded-xl border border-ink-line">
            {files.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 bg-ink-soft px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm text-paper">{f.file_name}</p>
                  <p className="font-mono text-[10px] text-fog">{formatBytes(f.size_bytes)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <a
                    href={getDownloadUrl(f.storage_path)}
                    download={f.file_name}
                    className="rounded-md border border-ink-line px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-paper hover:border-stamp hover:text-stamp-bright"
                  >
                    Download
                  </a>
                  <button
                    onClick={() => handleDeleteFile(f)}
                    aria-label={`Delete ${f.file_name}`}
                    className="rounded-md border border-ink-line px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-fog hover:border-rust hover:text-rust"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Expiry */}
      <section>
        <span className="mb-2 block font-mono text-[10px] uppercase tracking-[0.25em] text-fog">
          Keep this ticket for
        </span>
        <div className="flex flex-wrap gap-2">
          {EXPIRY_OPTIONS.map((opt) => (
            <button
              key={opt.hours}
              onClick={() => handleExpiryChange(opt.hours)}
              className="rounded-full border border-ink-line px-4 py-1.5 font-mono text-xs text-fog transition hover:border-brass hover:text-brass"
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
