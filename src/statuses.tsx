import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { Socket } from "socket.io-client";
import {
  AtSign,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ImagePlus,
  Plus,
  SmilePlus,
  Trash2,
  X,
} from "lucide-react";
import { api, token } from "./api";
import type { Person, StatusOverlay, StatusUpdate } from "./types";

const backgrounds: StatusUpdate["background"][] = [
  "sage",
  "ocean",
  "sunset",
  "dusk",
  "charcoal",
];
const stickers = ["✨", "❤️", "😂", "🔥", "🎉", "☕", "🌴", "💯"];
const stickerPositions = [
  [20, 24],
  [79, 28],
  [25, 76],
  [76, 72],
  [50, 20],
  [50, 82],
  [14, 50],
  [86, 52],
];

const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Unable to update statuses. Please retry.";

export function statusGroups(statuses: StatusUpdate[], me: string) {
  const groups = new Map<string, StatusUpdate[]>();
  for (const item of statuses) {
    const items = groups.get(item.owner.id) || [];
    items.push(item);
    groups.set(item.owner.id, items);
  }
  return [...groups.values()].sort((a, b) => {
    if (a[0].owner.id === me) return -1;
    if (b[0].owner.id === me) return 1;
    const aPriority = a.some((item) => item.tagged && !item.viewedAt)
      ? 2
      : a.some((item) => !item.viewedAt)
        ? 1
        : 0;
    const bPriority = b.some((item) => item.tagged && !item.viewedAt)
      ? 2
      : b.some((item) => !item.viewedAt)
        ? 1
        : 0;
    return (
      bPriority - aPriority ||
      b.at(-1)!.createdAt.localeCompare(a.at(-1)!.createdAt)
    );
  });
}

export function expiryLabel(expiresAt: string, now = Date.now()) {
  const remaining = Math.max(0, new Date(expiresAt).getTime() - now);
  const minutes = Math.ceil(remaining / 60000);
  if (minutes <= 1) return "Expires in under a minute";
  if (minutes < 60) return `Expires in ${minutes}m`;
  return `Expires in ${Math.ceil(minutes / 60)}h`;
}

function Initials({ name }: { name: string }) {
  return (
    <span className="status-avatar">
      {name
        .trim()
        .split(/\s+/)
        .map((part) => part[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()}
    </span>
  );
}

function StatusDialog({
  children,
  close,
  className = "",
  label,
}: {
  children: ReactNode;
  close: () => void;
  className?: string;
  label: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={className}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      {children}
    </dialog>
  );
}

function MediaBlob({ item }: { item: StatusUpdate }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    const controller = new AbortController();
    (async () => {
      const bearer = await token();
      const response = await fetch(`/api/statuses/${item.id}/media`, {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${bearer}` },
      });
      if (!response.ok) throw new Error();
      objectUrl = URL.createObjectURL(await response.blob());
      if (active) setUrl(objectUrl);
      else URL.revokeObjectURL(objectUrl);
    })().catch(() => {
      if (active && !controller.signal.aborted) setFailed(true);
    });
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [item.id]);
  if (failed) return <p className="status-media-note">Media unavailable</p>;
  if (!url) return <p className="status-media-note">Loading media…</p>;
  return item.media?.type === "video" ? (
    <video
      className="status-media"
      src={url}
      controls
      autoPlay
      playsInline
      aria-label={`${item.owner.name}'s status video`}
    />
  ) : (
    <img
      className="status-media"
      src={url}
      alt={`${item.owner.name}'s status photo`}
    />
  );
}

function StatusCanvas({
  item,
  previewUrl,
  previewType,
}: {
  item: Pick<
    StatusUpdate,
    "id" | "owner" | "background" | "text" | "overlays" | "mentions" | "media"
  >;
  previewUrl?: string;
  previewType?: "image" | "video";
}) {
  return (
    <div className={`status-canvas status-bg-${item.background}`}>
      {previewType ? (
        previewUrl ? (
          previewType === "video" ? (
            <video
              className="status-media"
              src={previewUrl}
              muted
              controls
              playsInline
              aria-label="Status video preview"
            />
          ) : (
            <img
              className="status-media"
              src={previewUrl}
              alt="Status preview"
            />
          )
        ) : (
          <p className="status-media-note">Preparing preview…</p>
        )
      ) : (
        item.media && <MediaBlob item={item as StatusUpdate} />
      )}
      {item.text && <p className="status-main-text">{item.text}</p>}
      {item.overlays.map((overlay, index) => (
        <span
          className={`status-overlay ${overlay.type}`}
          style={{ left: `${overlay.x}%`, top: `${overlay.y}%` }}
          key={`${overlay.type}-${index}-${overlay.value}`}
        >
          {overlay.value}
        </span>
      ))}
      {item.mentions.length > 0 && (
        <div className="status-tags" aria-label="Tagged contacts">
          {item.mentions.map((person) => (
            <span key={person.id}>@{person.handle}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusComposer({
  contacts,
  me,
  close,
  complete,
}: {
  contacts: Person[];
  me: Person;
  close: () => void;
  complete: () => Promise<void>;
}) {
  const [content, setContent] = useState("");
  const [background, setBackground] =
    useState<StatusUpdate["background"]>("sage");
  const [overlays, setOverlays] = useState<StatusOverlay[]>([]);
  const [tagged, setTagged] = useState<string[]>([]);
  const [media, setMedia] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!media) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(media);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [media]);
  const preview: Pick<
    StatusUpdate,
    "id" | "owner" | "background" | "text" | "overlays" | "mentions" | "media"
  > = {
    id: "preview",
    owner: me,
    background,
    text: content,
    overlays,
    mentions: contacts.filter((person) => tagged.includes(person.id)),
    media: media
      ? {
          type: media.type.startsWith("video/") ? "video" : "image",
          mimeType: media.type as NonNullable<
            StatusUpdate["media"]
          >["mimeType"],
          width: null,
          height: null,
          bytes: media.size,
        }
      : null,
  };
  function chooseMedia(file?: File) {
    if (!file) return;
    const image = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
    const video = ["video/mp4", "video/webm"].includes(file.type);
    if (!image && !video)
      setError("Choose a JPEG, PNG, WebP, MP4, or WebM file.");
    else if (image && file.size > 5 * 1024 * 1024)
      setError("Choose a photo up to 5 MB.");
    else if (video && file.size > 25 * 1024 * 1024)
      setError("Choose a video up to 25 MB.");
    else {
      setError("");
      setMedia(file);
    }
  }
  function addSticker(value: string) {
    if (overlays.length >= 8) return;
    const [x, y] = stickerPositions[overlays.length];
    setOverlays((old) => [...old, { type: "sticker", value, x, y }]);
  }
  function toggleTime() {
    setOverlays((old) => {
      if (old.some((overlay) => overlay.type === "time"))
        return old.filter((overlay) => overlay.type !== "time");
      if (old.length >= 8) return old;
      return [
        ...old,
        {
          type: "time",
          value: new Date().toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit",
          }),
          x: 50,
          y: 11,
        },
      ];
    });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!content.trim() && !media && overlays.length === 0) {
      setError("Add text, a sticker, a photo, or a video first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = new FormData();
      data.append("text", content);
      data.append("background", background);
      data.append("overlays", JSON.stringify(overlays));
      data.append("taggedIds", JSON.stringify(tagged));
      if (media) data.append("media", media);
      await api<StatusUpdate>("/statuses", { method: "POST", body: data });
      await complete();
      close();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <StatusDialog
      className="status-composer-dialog"
      label="Create status"
      close={close}
    >
      <header>
        <div>
          <span className="eyebrow">24-HOUR UPDATE</span>
          <h2>Create a status</h2>
        </div>
        <button
          className="icon"
          aria-label="Close status composer"
          onClick={close}
        >
          <X />
        </button>
      </header>
      <form className="status-composer-form" onSubmit={submit}>
        <div className="status-compose-layout">
          <StatusCanvas
            item={preview}
            previewUrl={previewUrl}
            previewType={
              media
                ? media.type.startsWith("video/")
                  ? "video"
                  : "image"
                : undefined
            }
          />
          <div className="status-tools">
            <label>
              Text on status
              <textarea
                aria-label="Status text"
                maxLength={500}
                rows={3}
                placeholder="Share what’s happening…"
                value={content}
                onChange={(event) => setContent(event.target.value)}
              />
            </label>
            <div className="status-tool-row">
              <label className="status-media-picker">
                <ImagePlus size={18} /> Photo or video
                <input
                  aria-label="Status photo or video"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
                  disabled={busy}
                  onChange={(event) => {
                    chooseMedia(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </label>
              {media && (
                <button type="button" onClick={() => setMedia(null)}>
                  <X size={16} /> Remove media
                </button>
              )}
              <button
                type="button"
                className={
                  overlays.some((overlay) => overlay.type === "time")
                    ? "selected"
                    : ""
                }
                onClick={toggleTime}
              >
                <Clock3 size={17} /> Add time
              </button>
            </div>
            <fieldset className="status-backgrounds">
              <legend>Background</legend>
              <div>
                {backgrounds.map((choice) => (
                  <button
                    type="button"
                    key={choice}
                    className={`status-bg-${choice} ${background === choice ? "selected" : ""}`}
                    aria-label={`Use ${choice} background`}
                    aria-pressed={background === choice}
                    onClick={() => setBackground(choice)}
                  />
                ))}
              </div>
            </fieldset>
            <fieldset className="status-sticker-picker">
              <legend>
                <SmilePlus size={16} /> Stickers
              </legend>
              <div>
                {stickers.map((sticker) => (
                  <button
                    type="button"
                    key={sticker}
                    aria-label={`Add ${sticker} sticker`}
                    disabled={overlays.length >= 8}
                    onClick={() => addSticker(sticker)}
                  >
                    {sticker}
                  </button>
                ))}
                {overlays.some((overlay) => overlay.type === "sticker") && (
                  <button
                    type="button"
                    className="status-clear-stickers"
                    onClick={() =>
                      setOverlays((old) =>
                        old.filter((overlay) => overlay.type !== "sticker"),
                      )
                    }
                  >
                    Clear
                  </button>
                )}
              </div>
            </fieldset>
            <fieldset className="status-contact-picker">
              <legend>
                <AtSign size={16} /> Tag contacts
              </legend>
              {contacts.length ? (
                <div className="status-contact-list">
                  {contacts.map((person) => (
                    <label key={person.id}>
                      <input
                        type="checkbox"
                        checked={tagged.includes(person.id)}
                        disabled={
                          !tagged.includes(person.id) && tagged.length >= 10
                        }
                        onChange={(event) =>
                          setTagged((old) =>
                            event.target.checked
                              ? [...old, person.id]
                              : old.filter((id) => id !== person.id),
                          )
                        }
                      />
                      <span>{person.name}</span>
                      <small>@{person.handle}</small>
                    </label>
                  ))}
                </div>
              ) : (
                <p>Start a conversation to add contacts you can tag.</p>
              )}
            </fieldset>
          </div>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <footer className="status-compose-actions">
          <small>
            Visible to your unblocked contacts for exactly 24 hours.
          </small>
          <button className="primary" disabled={busy}>
            {busy ? "Sharing…" : "Share status"}
          </button>
        </footer>
      </form>
    </StatusDialog>
  );
}

function StatusViewer({
  item,
  siblings,
  me,
  close,
  select,
  changed,
}: {
  item: StatusUpdate;
  siblings: StatusUpdate[];
  me: Person;
  close: () => void;
  select: (id: string) => void;
  changed: () => Promise<void>;
}) {
  const index = siblings.findIndex((status) => status.id === item.id);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (item.owner.id === me.id || item.viewedAt) return;
    void api(`/statuses/${item.id}/view`, { method: "POST" })
      .then(changed)
      .catch((cause) => setError(errorText(cause)));
  }, [item.id, item.owner.id, item.viewedAt, me.id, changed]);
  async function remove() {
    if (!confirm("Delete this status now?")) return;
    setBusy(true);
    try {
      await api(`/statuses/${item.id}`, { method: "DELETE" });
      await changed();
      const next = siblings[index + 1] || siblings[index - 1];
      if (next) select(next.id);
      else close();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <StatusDialog
      className="status-viewer-dialog"
      label={`${item.owner.name}'s status`}
      close={close}
    >
      <div
        className="status-progress"
        aria-label={`${index + 1} of ${siblings.length}`}
      >
        {siblings.map((status, position) => (
          <button
            type="button"
            aria-label={`View status ${position + 1}`}
            className={position <= index ? "active" : ""}
            key={status.id}
            onClick={() => select(status.id)}
          />
        ))}
      </div>
      <header className="status-viewer-head">
        <Initials name={item.owner.name} />
        <div>
          <strong>
            {item.owner.id === me.id ? "Your status" : item.owner.name}
          </strong>
          <small>
            {expiryLabel(item.expiresAt)}
            {item.tagged ? " · Tagged you" : ""}
          </small>
        </div>
        {item.owner.id === me.id && (
          <button
            className="icon"
            aria-label="Delete status"
            disabled={busy}
            onClick={remove}
          >
            <Trash2 size={18} />
          </button>
        )}
        <button
          className="icon"
          aria-label="Close status viewer"
          onClick={close}
        >
          <X />
        </button>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <StatusCanvas item={item} />
      <footer className="status-viewer-footer">
        <button
          aria-label="Previous status"
          disabled={index <= 0}
          onClick={() => select(siblings[index - 1].id)}
        >
          <ChevronLeft />
        </button>
        <span>
          {item.owner.id === me.id
            ? `${item.viewCount || 0} ${item.viewCount === 1 ? "view" : "views"}`
            : item.mentions.length
              ? `With ${item.mentions.map((person) => `@${person.handle}`).join(", ")}`
              : "24-hour status"}
        </span>
        <button
          aria-label="Next status"
          disabled={index >= siblings.length - 1}
          onClick={() => select(siblings[index + 1].id)}
        >
          <ChevronRight />
        </button>
      </footer>
    </StatusDialog>
  );
}

export function StatusTray({
  me,
  socket,
  onError,
}: {
  me: Person;
  socket: Socket | null;
  onError: (message: string) => void;
}) {
  const [statuses, setStatuses] = useState<StatusUpdate[]>([]);
  const [contacts, setContacts] = useState<Person[]>([]);
  const [composer, setComposer] = useState(false);
  const [selected, setSelected] = useState("");
  const load = useCallback(async () => {
    try {
      const [nextStatuses, nextContacts] = await Promise.all([
        api<StatusUpdate[]>("/statuses"),
        api<Person[]>("/statuses/contacts"),
      ]);
      setStatuses(nextStatuses);
      setContacts(nextContacts);
    } catch (cause) {
      onError(errorText(cause));
    }
  }, [onError]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!socket) return;
    const refresh = () => void load();
    socket.on("statuses:changed", refresh);
    socket.on("profile:updated", refresh);
    socket.on("conversations:changed", refresh);
    return () => {
      socket.off("statuses:changed", refresh);
      socket.off("profile:updated", refresh);
      socket.off("conversations:changed", refresh);
    };
  }, [socket, load]);
  useEffect(() => {
    if (!statuses.length) return;
    const earliest = Math.min(
      ...statuses.map((item) => new Date(item.expiresAt).getTime()),
    );
    const timeout = setTimeout(
      () => void load(),
      Math.max(50, earliest - Date.now() + 100),
    );
    return () => clearTimeout(timeout);
  }, [statuses, load]);
  const groups = useMemo(
    () => statusGroups(statuses, me.id),
    [statuses, me.id],
  );
  const own = groups.find((group) => group[0].owner.id === me.id);
  const active = statuses.find((item) => item.id === selected);
  const siblings = active
    ? groups.find((group) => group[0].owner.id === active.owner.id) || []
    : [];
  useEffect(() => {
    if (selected && !active) setSelected("");
  }, [selected, active]);
  function open(group: StatusUpdate[]) {
    setSelected(group.find((item) => !item.viewedAt)?.id || group[0].id);
  }
  return (
    <>
      <section className="status-tray" aria-label="Status updates">
        <div className="status-person own-status">
          {own ? (
            <button aria-label="View your status" onClick={() => open(own)}>
              <span className="status-ring seen">
                <Initials name={me.name} />
              </span>
              <span>My status</span>
            </button>
          ) : (
            <button aria-label="Add status" onClick={() => setComposer(true)}>
              <span className="status-ring empty">
                <Initials name={me.name} />
              </span>
              <span>My status</span>
            </button>
          )}
          <button
            className="status-add"
            aria-label="Add status"
            onClick={() => setComposer(true)}
          >
            <Plus size={13} />
          </button>
        </div>
        {groups
          .filter((group) => group[0].owner.id !== me.id)
          .map((group) => {
            const unseen = group.some((item) => !item.viewedAt);
            const tagged = group.some((item) => item.tagged && !item.viewedAt);
            return (
              <div className="status-person" key={group[0].owner.id}>
                <button
                  aria-label={`View ${group[0].owner.name}'s status`}
                  onClick={() => open(group)}
                >
                  <span className={`status-ring ${unseen ? "unseen" : "seen"}`}>
                    <Initials name={group[0].owner.name} />
                  </span>
                  <span>{group[0].owner.name.split(" ")[0]}</span>
                  {tagged && <small>Tagged you</small>}
                </button>
              </div>
            );
          })}
      </section>
      {composer && (
        <StatusComposer
          contacts={contacts}
          me={me}
          close={() => setComposer(false)}
          complete={load}
        />
      )}
      {active && (
        <StatusViewer
          item={active}
          siblings={siblings}
          me={me}
          close={() => setSelected("")}
          select={setSelected}
          changed={load}
        />
      )}
    </>
  );
}
