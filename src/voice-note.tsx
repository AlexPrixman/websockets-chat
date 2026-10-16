import { useEffect, useRef, useState } from "react";
import { Mic, Square, X } from "lucide-react";
import { token } from "./api";

export type Recording = { file: File; durationMs: number };
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_MS = 60_000;

export function VoiceNote({ id, durationMs }: { id: string; durationMs: number }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    const controller = new AbortController();
    (async () => {
      const bearer = await token();
      const response = await fetch(`/api/voice/${id}`, {
        signal: controller.signal, headers: { Authorization: `Bearer ${bearer}` },
      });
      if (!response.ok) throw new Error("Voice note unavailable");
      objectUrl = URL.createObjectURL(await response.blob());
      if (active) setUrl(objectUrl);
      else URL.revokeObjectURL(objectUrl);
    })().catch(() => { if (active) setError(true); });
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);
  if (error) return <p>Voice note unavailable</p>;
  return <div className="voice-message"><Mic size={16} />
    {url ? <audio controls preload="none" src={url} aria-label="Voice note" /> : <span>Loading voice note…</span>}
    <small>{Math.ceil(durationMs / 1000)}s</small>
  </div>;
}

export function useVoiceRecorder(conversationId: string, onError: (error: string) => void) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [note, setNote] = useState<Recording | null>(null);
  const [preview, setPreview] = useState("");
  const active = useRef<{ recorder: MediaRecorder; stream: MediaStream; started: number; chunks: Blob[]; bytes: number; canceled: boolean } | null>(null);
  const requesting = useRef(false);
  const conversation = useRef(conversationId);
  conversation.current = conversationId;
  useEffect(() => {
    if (!note) { setPreview(""); return; }
    const url = URL.createObjectURL(note.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [note]);
  function stop(cancel = false) {
    const current = active.current;
    if (!current) return;
    current.canceled ||= cancel;
    if (current.recorder.state !== "inactive") current.recorder.stop();
  }
  useEffect(() => {
    stop(true);
    setNote(null);
  }, [conversationId]);
  useEffect(() => () => { stop(true); }, []);
  useEffect(() => {
    if (!recording) return;
    const interval = setInterval(() => setElapsed(Math.round((Date.now() - (active.current?.started || Date.now())) / 1000)), 250);
    return () => clearInterval(interval);
  }, [recording]);
  async function start() {
    if (active.current || requesting.current) return;
    requesting.current = true;
    const id = conversation.current;
    let stream: MediaStream | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined")
        throw new Error("Voice notes need a browser with microphone access");
      const mimeType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"]
        .find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error("This browser cannot record a supported voice note");
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (conversation.current !== id) { stream.getTracks().forEach((track) => track.stop()); return; }
      const recorder = new MediaRecorder(stream, { mimeType });
      const current = { recorder, stream, started: Date.now(), chunks: [] as Blob[], bytes: 0, canceled: false };
      active.current = current;
      recorder.ondataavailable = (event) => {
        if (event.data.size) {
          current.chunks.push(event.data);
          current.bytes += event.data.size;
          if (current.bytes > MAX_BYTES) { onError("Voice notes must be under 5 MB"); stop(true); }
        }
      };
      recorder.onstop = () => {
        current.stream.getTracks().forEach((track) => track.stop());
        if (active.current === current) active.current = null;
        setRecording(false);
        if (current.canceled) return;
        const durationMs = Math.min(MAX_MS, Date.now() - current.started);
        if (durationMs < 250 || !current.bytes || current.bytes > MAX_BYTES) {
          onError("Record at least a second, up to 60 seconds and 5 MB");
          return;
        }
        const baseType = mimeType.split(";")[0];
        const ext = baseType === "audio/mp4" ? "m4a" : baseType === "audio/ogg" ? "ogg" : "webm";
        setNote({ file: new File(current.chunks, `voice-note.${ext}`, { type: baseType }), durationMs });
      };
      recorder.onerror = () => { onError("Recording failed. Please retry"); stop(true); };
      setNote(null);
      setElapsed(0);
      recorder.start(1000);
      setRecording(true);
      setTimeout(() => { if (active.current === current) stop(); }, MAX_MS);
    } catch (e) {
      stream?.getTracks().forEach((track) => track.stop());
      onError(e instanceof Error ? e.message : "Microphone unavailable");
    } finally {
      requesting.current = false;
    }
  }
  return { recording, elapsed, note, preview, start, stop, clear: () => setNote(null) };
}

export function RecordingControls({ voice, disabled }: {
  voice: ReturnType<typeof useVoiceRecorder>; disabled: boolean;
}) {
  if (voice.recording) return <div className="recording-controls" role="status">
    <span className="record-dot" /> Recording {voice.elapsed}s / 60s
    <button type="button" onClick={() => voice.stop(true)} aria-label="Cancel recording"><X size={17} /> Cancel</button>
    <button type="button" onClick={() => voice.stop()} aria-label="Stop recording"><Square size={16} /> Stop</button>
  </div>;
  if (voice.note) return <div className="recording-controls">
    {voice.preview && <audio controls src={voice.preview} aria-label="Voice note preview" />}
    <button type="button" disabled={disabled} onClick={voice.clear} aria-label="Remove voice note"><X size={17} /> Remove</button>
  </div>;
  return null;
}
