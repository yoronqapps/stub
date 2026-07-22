"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import {
  buildRoomLink,
  isValidRoomAccessKey,
  isValidRoomCode,
  normalizeRoomAccessKey,
  normalizeRoomCode,
} from "@/lib/roomCode";
import {
  DEFAULT_EXPIRY_HOURS,
  EXPIRY_OPTIONS,
  expiryFromNow,
  formatTimeLeft,
} from "@/lib/expiry";
import {
  createSupabaseClient,
  FILES_BUCKET,
  MAX_FILE_BYTES,
} from "@/lib/supabaseClient";

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
  const validCode = isValidRoomCode(code);

  const [roomKey, setRoomKey] = useState("");
  const validRoomKey = isValidRoomAccessKey(roomKey);

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
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const isTypingRef = useRef(false);

  const roomClient = useMemo(() => {
    if (!validCode || !validRoomKey) return null;
    return createSupabaseClient({ roomCode: code, roomKey });
  }, [code, roomKey, validCode, validRoomKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncKeyFromHash = () => {
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const key = normalizeRoomAccessKey(params.get("k") || "");
      setRoomKey(key);
    };

    syncKeyFromHash();
    window.addEventListener("hashchange", syncKeyFromHash);

    return () => window.removeEventListener("hashchange", syncKeyFromHash);
  }, []);

  const refreshRoomSnapshot = useCallback(async () => {
    if (!roomClient) return;

    setConn("connecting");

    const { data: existing, error: fetchErr } = await roomClient
      .from("rooms")
      .select("*")
      .eq("code", code)
      .maybeSingle();

    if (fetchErr) {
      setConn("offline");
      setErrorMsg("Couldn't reach the clipboard service. Check your connection and refresh.");
      setLoading(false);
      return;
    }

    let roomRow = existing as RoomRow | null;

    if (!roomRow) {
      const { data: created, error: insertErr } = await roomClient
        .from("rooms")
        .insert({
          code,
          access_key: roomKey,
          text_content: "",
          expires_at: expiryFromNow(DEFAULT_EXPIRY_HOURS),
        })
        .select("*")
        .single();

      if (insertErr) {
        setConn("offline");
        if (insertErr.code === "23505") {
          setErrorMsg("This ticket exists, but this key cannot open it. Use the original full ticket link.");
        } else {
          setErrorMsg("Couldn't create this ticket securely. Try refreshing.");
        }
        setLoading(false);
        return;
      }

      roomRow = created as RoomRow;
    }

    setRoom(roomRow);
    const nextText = roomRow.text_content || "";
    const isActiveEdit = isTypingRef.current && textAreaRef.current === document.activeElement;

    if (!isActiveEdit || nextText === lastSentContent.current) {
      setText(nextText);
    }
    lastSentContent.current = roomRow.text_content || "";

    const { data: fileRows, error: filesErr } = await roomClient
      .from("room_files")
      .select("*")
      .eq("room_code", code)
      .order("created_at", { ascending: false });

    if (filesErr) {
      setConn("offline");
      setErrorMsg("Room opened, but files are temporarily unavailable. Refresh in a moment.");
      setLoading(false);
      return;
    }

    setFiles((fileRows || []) as FileRow[]);
    setConn("live");
    setLoading(false);
  }, [roomClient, code, roomKey]);

  // ---- Bootstrap + polling ----
  useEffect(() => {
    if (!validCode) {
      setLoading(false);
      return;
    }
    if (!validRoomKey || !roomClient) {
      setLoading(false);
      return;
    }

    let mounted = true;

    const runRefresh = async () => {
      if (!mounted) return;
      await refreshRoomSnapshot();
    };

    runRefresh();
    const intervalId = window.setInterval(runRefresh, 2000);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
      if (debounceTimer.current) window.clearTimeout(debounceTimer.current);
    };
  }, [validCode, validRoomKey, roomClient, refreshRoomSnapshot]);

  // ---- QR code for the room link ----
  useEffect(() => {
    if (!validCode || !validRoomKey || typeof window === "undefined") return;
    const url = buildRoomLink(window.location.origin, code, roomKey);
    QRCode.toDataURL(url, {
      margin: 1,
      width: 220,
      color: { dark: "#16181D", light: "#EDE4D000" },
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [code, roomKey, validCode, validRoomKey]);

  // ---- Debounced text sync ----
  const handleTextChange = useCallback(
    (value: string) => {
      if (!roomClient) return;
      setText(value);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(async () => {
        lastSentContent.current = value;
        await roomClient
          .from("rooms")
          .update({ text_content: value, updated_at: new Date().toISOString() })
          .eq("code", code);
      }, 500);
    },
    [roomClient, code]
  );

  // ---- File upload ----
  async function uploadFiles(fileList: FileList | File[]) {
    if (!roomClient) return;
    setErrorMsg(null);

    for (const file of Array.from(fileList)) {
      if (file.size > MAX_FILE_BYTES) {
        setErrorMsg(`"${file.name}" is over the 100MB limit and wasn't uploaded.`);
        continue;
      }

      const tempKey = `${file.name}-${file.size}-${Date.now()}`;
      setUploading((prev) => ({ ...prev, [tempKey]: true }));
      const path = `${code}/${Date.now()}-${file.name}`;

      const { error: uploadErr } = await roomClient.storage
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

      const { error: rowErr } = await roomClient.from("room_files").insert({
        room_code: code,
        file_name: file.name,
        storage_path: path,
        size_bytes: file.size,
      });

      if (rowErr) {
        setErrorMsg(`"${file.name}" uploaded, but metadata sync failed.`);
      }

      setUploading((prev) => {
        const next = { ...prev };
        delete next[tempKey];
        return next;
      });
    }

    await refreshRoomSnapshot();
  }

  async function handleDeleteFile(f: FileRow) {
    if (!roomClient) return;
    setFiles((prev) => prev.filter((x) => x.id !== f.id));
    await roomClient.storage.from(FILES_BUCKET).remove([f.storage_path]);
    await roomClient.from("room_files").delete().eq("id", f.id);
  }

  async function handleDownload(path: string) {
    if (!roomClient) return;
    const { data, error } = await roomClient.storage
      .from(FILES_BUCKET)
      .createSignedUrl(path, 120);

    if (error || !data?.signedUrl) {
      setErrorMsg("Couldn't generate a secure download link. Try again.");
      return;
    }

    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function handleExpiryChange(hours: number) {
    if (!roomClient) return;
    const expires_at = expiryFromNow(hours);
    await roomClient.from("rooms").update({ expires_at }).eq("code", code);
    setRoom((prev) => (prev ? { ...prev, expires_at } : prev));
  }

  function handleCopyLink() {
    if (typeof window === "undefined" || !validRoomKey) return;
    const url = buildRoomLink(window.location.origin, code, roomKey);
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  // ---- Invalid code screen ----
  if (!validCode) {
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

  if (!validRoomKey) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <p className="mb-3 font-mono text-xs uppercase tracking-[0.3em] text-brass">Clipticket</p>
        <h1 className="mb-3 text-2xl font-semibold text-paper">This ticket needs its security key</h1>
        <p className="mb-8 max-w-md text-sm text-fog">
          Open this room using the full ticket URL shared by its creator. The secure key lives in the link fragment after #k=.
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
          Punching your ticket...
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-10 sm:px-6">
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
              {conn === "live" ? "live" : conn === "connecting" ? "syncing" : "offline"}
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
            {copied ? "Copied" : "Copy secure link"}
          </button>
        </div>
      </header>

      {errorMsg && (
        <div className="mb-6 rounded-md border border-rust/40 bg-rust/10 px-4 py-3 font-mono text-xs text-rust">
          {errorMsg}
        </div>
      )}

      <section className="mb-6">
        <label htmlFor="clip-text" className="mb-2 block font-mono text-[10px] uppercase tracking-[0.25em] text-fog">
          Shared text
        </label>
        <textarea
          id="clip-text"
          ref={textAreaRef}
          value={text}
          onFocus={() => {
            isTypingRef.current = true;
          }}
          onBlur={() => {
            isTypingRef.current = false;
          }}
          onChange={(e) => handleTextChange(e.target.value)}
          placeholder="Type or paste anything and it syncs across devices with this secure link."
          className="h-56 w-full resize-y rounded-xl border border-ink-line bg-ink-soft px-4 py-3 font-mono text-sm leading-relaxed text-paper placeholder:text-fog/50 focus:border-brass focus:outline-none"
        />
      </section>

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
                Uploading {k.split("-")[0]}...
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
                  <button
                    onClick={() => handleDownload(f.storage_path)}
                    className="rounded-md border border-ink-line px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-paper hover:border-stamp hover:text-stamp-bright"
                  >
                    Download
                  </button>
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
