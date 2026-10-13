import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { io, type Socket } from "socket.io-client";
import {
  MessageCircle,
  Plus,
  Search,
  Send,
  ImagePlus,
  ArrowLeft,
  Settings,
  LogOut,
  Users,
  ShieldCheck,
  X,
  Trash2,
  Flag,
  CheckCheck,
} from "lucide-react";
import { api, auth, json, token } from "./api";
import {
  mergeMessages,
  titleOf,
  type Person,
  type Conversation,
  type Message,
} from "./types";

const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong. Please retry.";
function Avatar({ name, group = false }: { name: string; group?: boolean }) {
  return (
    <span className={"avatar " + (group ? "group" : "")}>
      {group ? (
        <Users size={21} />
      ) : (
        name
          .trim()
          .split(/\s+/)
          .map((s) => s[0])
          .slice(0, 2)
          .join("")
          .toUpperCase()
      )}
    </span>
  );
}
function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button aria-label="Close dialog" className="icon" onClick={close}>
          <X />
        </button>
      </header>
      {children}
    </dialog>
  );
}
function Login({ done }: { done: () => void }) {
  const [mode, setMode] = useState<"signin" | "signup" | "verify" | "reset">(
      "signin",
    ),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (mode === "verify") {
        const r = await auth.emailOtp.verifyEmail({ email, otp: code });
        if (r.error) throw new Error(r.error.message);
        setMode("signin");
        setNotice("Email verified. You can now sign in.");
      } else if (mode === "reset") {
        const r = await auth.emailOtp.resetPassword({
          email,
          otp: code,
          password,
        });
        if (r.error) throw new Error(r.error.message);
        setMode("signin");
        setNotice("Password reset. Sign in with your new password.");
      } else {
        const r =
          mode === "signup"
            ? await auth.signUp.email({ name, email, password })
            : await auth.signIn.email({ email, password });
        if (r.error) throw new Error(r.error.message);
        const s = await auth.getSession();
        if (s.data?.user) done();
        else {
          setMode("verify");
          setNotice("Enter the verification code sent to your email.");
        }
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function requestCode(type: "email-verification" | "forget-password") {
    setBusy(true);
    setError("");
    try {
      const r = await auth.emailOtp.sendVerificationOtp({ email, type });
      if (r.error) throw new Error(r.error.message);
      setMode(type === "forget-password" ? "reset" : "verify");
      setNotice("If this address is eligible, a code has been sent.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login">
      <section className="intro">
        <a className="brand" href="/">
          <MessageCircle />
          circlechat<span>●</span>
        </a>
        <div>
          <span className="eyebrow">A LITTLE CLOSER, EVEN FROM AFAR</span>
          <h1>
            Good conversations.
            <br />
            <em>Great company.</em>
          </h1>
          <p>
            A place for your people. Share the everyday, make a group, and keep
            the conversation going.
          </p>
          <div className="sample">
            <Avatar name="Jane Doe" />
            <div>
              <strong>
                Jane Doe <small>just now</small>
              </strong>
              <p>Same time, same place? ☕</p>
            </div>
          </div>
          <div className="sample reply">Wouldn’t miss it. ✨</div>
        </div>
        <footer>
          <ShieldCheck size={18} /> Member-only chats · Private photo access
        </footer>
      </section>
      <section className="auth">
        <div className="auth-card">
          <span className="eyebrow">YOUR CIRCLE IS WAITING</span>
          <h2>
            {mode === "signin"
              ? "Welcome back."
              : mode === "signup"
                ? "Make yourself at home."
                : mode === "verify"
                  ? "Check your inbox."
                  : "A fresh start."}
          </h2>
          <p>
            {mode === "signin"
              ? "Sign in to pick up where you left off."
              : "Connect with people, one conversation at a time."}
          </p>
          <form onSubmit={submit}>
            {mode === "signup" && (
              <label>
                Your name
                <input
                  required
                  maxLength={80}
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            )}
            <label>
              Email address
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            {mode !== "verify" && (
              <label>
                {mode === "reset" ? "New password" : "Password"}
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete={
                    mode === "signin" ? "current-password" : "new-password"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            )}
            {(mode === "verify" || mode === "reset") && (
              <label>
                Verification code
                <input
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </label>
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            {notice && <p role="status">{notice}</p>}
            <button className="primary" disabled={busy}>
              {busy
                ? "Please wait…"
                : mode === "signin"
                  ? "Sign in"
                  : mode === "signup"
                    ? "Create account"
                    : mode === "verify"
                      ? "Verify email"
                      : "Reset password"}
            </button>
          </form>
          <div className="auth-actions">
            <button
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setError("");
              }}
            >
              {mode === "signin"
                ? "New here? Create an account"
                : "Back to sign in"}
            </button>
            {mode === "signin" && (
              <>
                <button
                  disabled={busy || !email}
                  onClick={() => requestCode("forget-password")}
                >
                  Forgot password?
                </button>
                <button
                  disabled={busy || !email}
                  onClick={() => requestCode("email-verification")}
                >
                  Verify email
                </button>
              </>
            )}
          </div>
          <p className="privacy-note">
            Portfolio demo. Don’t share sensitive information. Messages are
            access-controlled, not end-to-end encrypted.
          </p>
        </div>
      </section>
    </div>
  );
}
function Photo({ id }: { id: string }) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState(false);
  useEffect(() => {
    let active = true,
      objectUrl = "";
    const controller = new AbortController();
    (async () => {
      const bearer = await token();
      const r = await fetch("/api/photos/" + id, {
        signal: controller.signal,
        headers: { Authorization: "Bearer " + bearer },
      });
      if (!r.ok) throw new Error();
      objectUrl = URL.createObjectURL(await r.blob());
      if (active) setUrl(objectUrl);
      else URL.revokeObjectURL(objectUrl);
    })().catch(() => {
      if (active) setError(true);
    });
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);
  return error ? (
    <p>Photo unavailable</p>
  ) : url ? (
    <a href={url} target="_blank" rel="noreferrer">
      <img className="chat-photo" src={url} alt="Shared photo" />
    </a>
  ) : (
    <p>Loading photo…</p>
  );
}
export default function App() {
  const [ready, setReady] = useState(false),
    [me, setMe] = useState<Person | null>(null),
    [bootError, setBootError] = useState("");
  async function restore() {
    try {
      const session = await auth.getSession();
      if (session.error) throw new Error(session.error.message);
      if (session.data?.user) setMe(await api<Person>("/me"));
      else setMe(null);
      setBootError("");
    } catch (e) {
      setBootError(errorText(e));
    } finally {
      setReady(true);
    }
  }
  useEffect(() => {
    void restore();
  }, []);
  if (!ready) return <div className="loading">Opening your circle…</div>;
  if (bootError)
    return (
      <main className="loading">
        <p role="alert">{bootError}</p>
        <button onClick={restore}>Try again</button>
        <button
          onClick={async () => {
            await auth.signOut();
            setBootError("");
            setMe(null);
          }}
        >
          Back to sign in
        </button>
      </main>
    );
  if (!me) return <Login done={restore} />;
  return (
    <ChatApp
      me={me}
      updateMe={setMe}
      logout={async () => {
        await api("/logout", json("POST", {}));
        await auth.signOut();
        setMe(null);
      }}
    />
  );
}
function ChatApp({
  me,
  updateMe,
  logout,
}: {
  me: Person;
  updateMe: (p: Person) => void;
  logout: () => Promise<void>;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]),
    [selected, setSelected] = useState(""),
    [messages, setMessages] = useState<Message[]>([]),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [connected, setConnected] = useState(false),
    [loading, setLoading] = useState(false),
    [hasMore, setHasMore] = useState(false),
    [draft, setDraft] = useState(""),
    [photo, setPhoto] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState<"new" | "settings" | null>(null),
    [typing, setTyping] = useState(""),
    [online, setOnline] = useState<string[]>([]),
    [receipts, setReceipts] = useState<
      { userId: string; lastReadId: string }[]
    >([]);
  const socket = useRef<Socket | null>(null),
    selectedRef = useRef(""),
    epoch = useRef(0),
    pending = useRef<{
      text: string;
      file: File | null;
      clientId: string;
      photoId?: string;
    } | null>(null),
    bottom = useRef<HTMLDivElement>(null),
    typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const current = conversations.find((c) => c.id === selected);
  const refresh = async () => {
    setConversations(await api<Conversation[]>("/conversations"));
  };
  async function load(id: string, older = false) {
    const generation = epoch.current;
    setLoading(true);
    try {
      const page = await api<{ items: Message[]; hasMore: boolean }>(
        `/conversations/${id}/messages${older && messages.length ? "?before=" + messages[0].id : ""}`,
      );
      if (selectedRef.current !== id || epoch.current !== generation) return;
      setMessages((old) => mergeMessages(old, page.items));
      setHasMore(page.hasMore);
      const [r, p] = await Promise.all([
        api<typeof receipts>(`/conversations/${id}/receipts`),
        api<string[]>(`/conversations/${id}/presence`),
      ]);
      if (selectedRef.current === id && epoch.current === generation) {
        setReceipts(r);
        setOnline(p);
      }
    } catch (e) {
      if (selectedRef.current === id) setError(errorText(e));
    } finally {
      if (epoch.current === generation) setLoading(false);
    }
  }
  useEffect(() => {
    selectedRef.current = selected;
    epoch.current++;
    setMessages([]);
    setDraft("");
    setPhoto(null);
    setTyping("");
    setOnline([]);
    setReceipts([]);
    pending.current = null;
    if (selected) void load(selected);
  }, [selected]);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const s = io({
      autoConnect: false,
      auth: async (cb) => {
        try {
          cb({ token: await token() });
        } catch {
          setError("Session expired. Please sign in again.");
        }
      },
    });
    socket.current = s;
    s.on("connect", () => {
      setConnected(true);
      setError("");
      void refresh().catch((e) => setError(errorText(e)));
      if (selectedRef.current) void load(selectedRef.current);
    });
    s.on("disconnect", () => setConnected(false));
    s.on("connect_error", () => {
      setConnected(false);
      setError("Connection interrupted. Reconnecting…");
    });
    s.on("auth:expired", () => {
      timer = setTimeout(() => {
        if (!stopped) s.connect();
      }, 500);
    });
    s.on(
      "conversations:changed",
      () => void refresh().catch((e) => setError(errorText(e))),
    );
    s.on("profile:updated", () => void refresh().catch(() => {}));
    s.on("message:new", (m: Message) => {
      if (selectedRef.current === m.conversationId)
        setMessages((old) => mergeMessages(old, [m]));
      void refresh().catch(() => {});
    });
    s.on("message:updated", (m: Message) => {
      if (selectedRef.current === m.conversationId)
        setMessages((old) => mergeMessages(old, [m]));
      void refresh().catch(() => {});
    });
    s.on(
      "message:read",
      (r: { conversationId: string; userId: string; lastReadId: string }) => {
        if (r.conversationId === selectedRef.current)
          setReceipts((old) => [
            ...old.filter((x) => x.userId !== r.userId),
            r,
          ]);
      },
    );
    s.on(
      "typing",
      (r: { conversationId: string; name: string; active: boolean }) => {
        if (r.conversationId === selectedRef.current) {
          setTyping(r.active ? r.name : "");
          clearTimeout(typingTimer.current);
          typingTimer.current = setTimeout(() => setTyping(""), 2500);
        }
      },
    );
    s.on("presence:changed", (p: { userId: string; online: boolean }) =>
      setOnline((old) =>
        p.online
          ? [...new Set([...old, p.userId])]
          : old.filter((x) => x !== p.userId),
      ),
    );
    s.connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(typingTimer.current);
      s.disconnect();
      socket.current = null;
    };
  }, []);
  const lastId = messages.at(-1)?.id;
  useEffect(() => {
    if (!selected || !lastId || document.visibilityState === "hidden") return;
    void api(
      `/conversations/${selected}/read`,
      json("POST", { lastReadId: lastId }),
    )
      .then(refresh)
      .catch(() => {});
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [selected, lastId]);
  async function send(e: FormEvent) {
    e.preventDefault();
    if (busy || (!draft.trim() && !photo) || !selected) return;
    const id = selected;
    setBusy(true);
    setError("");
    try {
      let attempt = pending.current;
      if (!attempt || attempt.text !== draft || attempt.file !== photo)
        attempt = pending.current = {
          text: draft,
          file: photo,
          clientId: crypto.randomUUID(),
        };
      if (photo && !attempt.photoId) {
        const data = new FormData();
        data.append("photo", photo);
        const result = await api<{ id: string }>(
          `/conversations/${id}/photos`,
          { method: "POST", body: data },
        );
        attempt.photoId = result.id;
      }
      const message = await api<Message>(
        `/conversations/${id}/messages`,
        json("POST", {
          text: attempt.text,
          clientId: attempt.clientId,
          photoId: attempt.photoId,
        }),
      );
      if (selectedRef.current === id) {
        setMessages((old) => mergeMessages(old, [message]));
        setDraft("");
        setPhoto(null);
        pending.current = null;
      }
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function action(job: () => Promise<unknown>) {
    try {
      await job();
      setError("");
      await refresh();
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <div className={"workspace " + (selected ? "conversation-open" : "")}>
      <nav className="rail" aria-label="App">
        <a className="logo-mark" href="/" aria-label="CircleChat home">
          <MessageCircle />
        </a>
        <button
          className="rail-active"
          aria-label="Conversations"
          onClick={() => setSelected("")}
        >
          <MessageCircle />
        </button>
        <div className="rail-bottom">
          <button
            aria-label="Profile and settings"
            onClick={() => setModal("settings")}
          >
            <Settings />
          </button>
          <button aria-label="Sign out" onClick={() => action(logout)}>
            <LogOut />
          </button>
          <Avatar name={me.name} />
        </div>
      </nav>
      <aside className="sidebar">
        <header>
          <div>
            <span className="eyebrow">YOUR EVERYDAY PEOPLE</span>
            <h1>
              Messages<span>.</span>
            </h1>
          </div>
          <button
            className="new-button"
            aria-label="New conversation"
            onClick={() => setModal("new")}
          >
            <Plus />
          </button>
        </header>
        <div className="search">
          <Search size={18} />
          <input
            aria-label="Search conversations"
            placeholder="Find a conversation"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="list-label">
          ALL CONVERSATIONS <span>{conversations.length}</span>
        </div>
        <div className="conversation-list">
          {conversations
            .filter((c) =>
              titleOf(c, me.id).toLowerCase().includes(query.toLowerCase()),
            )
            .map((c) => (
              <button
                key={c.id}
                className={
                  "conversation " + (selected === c.id ? "selected" : "")
                }
                onClick={() => setSelected(c.id)}
              >
                <Avatar name={titleOf(c, me.id)} group={c.kind === "group"} />
                <div>
                  <strong>{titleOf(c, me.id)}</strong>
                  <p>{c.lastMessage}</p>
                </div>
                <div className="conversation-meta">
                  <small>
                    {new Date(c.updatedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </small>
                  {c.unread > 0 && <span className="unread">{c.unread}</span>}
                </div>
              </button>
            ))}
          {conversations.length === 0 && (
            <div className="list-empty">
              <p>Your next great conversation starts here.</p>
              <button onClick={() => setModal("new")}>
                Find your people <Plus size={15} />
              </button>
            </div>
          )}
        </div>
        <footer className="connection">
          <span className={connected ? "dot" : "dot offline"} />
          {connected ? "Connected, in real time" : "Reconnecting…"}
          <small>circlechat</small>
        </footer>
      </aside>
      <main className="chat-panel">
        {error && (
          <div role="alert" className="error banner">
            {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {current ? (
          <>
            <header className="chat-header">
              <button
                className="icon mobile-back"
                aria-label="Back to conversations"
                onClick={() => setSelected("")}
              >
                <ArrowLeft />
              </button>
              <Avatar
                name={titleOf(current, me.id)}
                group={current.kind === "group"}
              />
              <div>
                <h2>{titleOf(current, me.id)}</h2>
                <p>
                  {current.blocked
                    ? "Messaging unavailable"
                    : typing
                      ? `${typing} is typing…`
                      : current.kind === "group"
                        ? `${current.members.length} people · ${online.length} online`
                        : online.some((x) => x !== me.id)
                          ? "Online now"
                          : "Your private conversation"}
                </p>
              </div>
              <button
                className="icon"
                aria-label="Conversation members"
                onClick={() => setModal("settings")}
              >
                <Users />
              </button>
            </header>
            <div
              className="message-area"
              aria-label="Messages"
              aria-busy={loading}
            >
              {hasMore && (
                <button
                  className="load-more"
                  disabled={loading}
                  onClick={() => load(selected, true)}
                >
                  Load earlier messages
                </button>
              )}
              {loading && !messages.length && (
                <p className="center-note">Loading conversation…</p>
              )}
              {!loading && !messages.length && (
                <div className="conversation-start">
                  <Avatar
                    name={titleOf(current, me.id)}
                    group={current.kind === "group"}
                  />
                  <h3>A fresh conversation.</h3>
                  <p>Say hello to {titleOf(current, me.id)}.</p>
                </div>
              )}
              {messages.map((m) => (
                <article
                  key={m.id}
                  className={"message " + (m.senderId === me.id ? "mine" : "")}
                >
                  <div className="bubble">
                    <small className="sender">
                      {m.senderId === me.id ? "You" : m.senderName}
                    </small>
                    {m.photo && <Photo id={m.photo.id} />}
                    <p>{m.deletedAt ? <em>Message removed</em> : m.text}</p>
                    <div className="message-meta">
                      <time dateTime={m.createdAt}>
                        {new Date(m.createdAt).toLocaleTimeString(undefined, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                      {m.senderId === me.id && (
                        <span
                          title={
                            receipts.some(
                              (r) =>
                                r.userId !== me.id &&
                                BigInt(r.lastReadId) >= BigInt(m.id),
                            )
                              ? "Read"
                              : "Sent"
                          }
                        >
                          <CheckCheck size={14} />
                        </span>
                      )}
                      {!m.deletedAt &&
                        (m.senderId === me.id ? (
                          <button
                            aria-label="Delete message"
                            onClick={() => {
                              if (confirm("Remove this message for everyone?"))
                                void action(() =>
                                  api("/messages/" + m.id, {
                                    method: "DELETE",
                                  }),
                                );
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        ) : (
                          <button
                            aria-label="Report message"
                            onClick={() => {
                              const reason = prompt(
                                "Why are you reporting this message?",
                              );
                              if (reason)
                                void action(() =>
                                  api(
                                    "/reports",
                                    json("POST", { messageId: m.id, reason }),
                                  ),
                                );
                            }}
                          >
                            <Flag size={13} />
                          </button>
                        ))}
                    </div>
                  </div>
                </article>
              ))}
              <div ref={bottom} />
            </div>
            <div className="composer-wrap">
              {photo && (
                <div className="attachment">
                  {photo.name}
                  <button
                    aria-label="Remove attachment"
                    disabled={busy}
                    onClick={() => setPhoto(null)}
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
              <form className="composer" onSubmit={send}>
                <label className="attach" title="Share a photo">
                  <ImagePlus />
                  <span className="sr-only">Attach photo</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={busy || current.blocked}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f && f.size > 5 * 1024 * 1024)
                        setError("Choose a photo up to 5 MB");
                      else setPhoto(f || null);
                      e.target.value = "";
                    }}
                  />
                </label>
                <textarea
                  aria-label="Message"
                  placeholder={
                    current.blocked
                      ? "Messaging is unavailable"
                      : "Write a little something…"
                  }
                  maxLength={4000}
                  rows={1}
                  disabled={busy || current.blocked}
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    socket.current?.emit("typing", {
                      conversationId: selected,
                      active: !!e.target.value,
                    });
                  }}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                <button
                  className="send"
                  aria-label="Send message"
                  disabled={
                    busy || current.blocked || (!draft.trim() && !photo)
                  }
                >
                  <Send size={20} />
                </button>
              </form>
              <p className="composer-hint">
                {busy
                  ? "Sending…"
                  : "Enter to send · Shift + Enter for a new line"}
              </p>
            </div>
          </>
        ) : (
          <div className="welcome">
            <div className="welcome-symbol">
              <MessageCircle size={58} />
              <span>✦</span>
            </div>
            <span className="eyebrow">LESS SCROLLING. MORE CONNECTING.</span>
            <h2>
              Your people.
              <br />
              <em>One happy place.</em>
            </h2>
            <p>
              From quick hellos to big plans.
              <br />
              Pick a conversation or start something new.
            </p>
            <button className="primary" onClick={() => setModal("new")}>
              <Plus size={18} /> Start a conversation
            </button>
            <small>
              <ShieldCheck size={15} /> Only conversation members can access
              messages and photos.
            </small>
          </div>
        )}
      </main>
      {modal === "new" && (
        <NewChat
          close={() => setModal(null)}
          created={async (id) => {
            await refresh();
            setSelected(id);
            setModal(null);
          }}
        />
      )}
      {modal === "settings" && (
        <SettingsPanel
          me={me}
          members={current?.members || []}
          update={updateMe}
          close={() => setModal(null)}
          changed={refresh}
        />
      )}
    </div>
  );
}
function NewChat({
  close,
  created,
}: {
  close: () => void;
  created: (id: string) => Promise<void>;
}) {
  const [q, setQ] = useState(""),
    [people, setPeople] = useState<Person[]>([]),
    [chosen, setChosen] = useState<Person[]>([]),
    [group, setGroup] = useState(false),
    [title, setTitle] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    api<Person[]>("/people?q=" + encodeURIComponent(q), {
      signal: controller.signal,
    })
      .then(setPeople)
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorText(e));
      });
    return () => controller.abort();
  }, [q]);
  return (
    <Modal title="Bring your people together" close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const c = await api<{ id: string }>(
              "/conversations",
              json("POST", {
                kind: group ? "group" : "direct",
                title,
                memberIds: chosen.map((p) => p.id),
              }),
            );
            await created(c.id);
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="checkbox">
          <input
            type="checkbox"
            checked={group}
            onChange={(e) => {
              setGroup(e.target.checked);
              setChosen([]);
            }}
          />
          Make it a group
        </label>
        {group && (
          <label>
            Group name
            <input
              required
              maxLength={60}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
        )}
        <label>
          Find people
          <input
            placeholder="Search by name or handle"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <p className="muted">
          {chosen.length
            ? chosen.map((p) => p.name).join(", ")
            : "Choose someone to start chatting."}
        </p>
        <div className="people-list">
          {people.map((p) => (
            <label className="person" key={p.id}>
              <Avatar name={p.name} />
              <span>
                <strong>{p.name}</strong>
                <small>@{p.handle}</small>
              </span>
              <input
                type="checkbox"
                checked={chosen.some((x) => x.id === p.id)}
                onChange={(e) =>
                  setChosen((old) =>
                    e.target.checked
                      ? group
                        ? [...old, p].slice(0, 8)
                        : [p]
                      : old.filter((x) => x.id !== p.id),
                  )
                }
              />
            </label>
          ))}
          {!people.length && (
            <p>No people found. Invite a friend to create an account.</p>
          )}
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy || !chosen.length}>
          {busy ? "Creating…" : "Start chatting"}
        </button>
      </form>
    </Modal>
  );
}
function SettingsPanel({
  me,
  members,
  update,
  close,
  changed,
}: {
  me: Person;
  members: Person[];
  update: (p: Person) => void;
  close: () => void;
  changed: () => Promise<void>;
}) {
  const [name, setName] = useState(me.name),
    [handle, setHandle] = useState(me.handle),
    [bio, setBio] = useState(me.bio),
    [blocks, setBlocks] = useState<Person[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = () => api<Person[]>("/blocks").then(setBlocks);
  useEffect(() => {
    refresh().catch((e) => setError(errorText(e)));
  }, []);
  async function block(p: Person, remove = false) {
    try {
      await api("/blocks/" + encodeURIComponent(p.id), {
        method: remove ? "DELETE" : "PUT",
      });
      await refresh();
      await changed();
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <Modal title="Your profile & privacy" close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            update(
              await api<Person>("/me", json("PATCH", { name, handle, bio })),
            );
            setNotice("Profile saved");
            await changed();
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Name
          <input
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Handle
          <input
            required
            minLength={3}
            maxLength={24}
            pattern="[a-zA-Z][a-zA-Z0-9_]{2,23}"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
          />
        </label>
        <label>
          A little about you
          <textarea
            maxLength={160}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
          />
        </label>
        <button className="primary" disabled={busy}>
          Save profile
        </button>
      </form>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {members
        .filter((p) => p.id !== me.id && !blocks.some((b) => b.id === p.id))
        .map((p) => (
          <div className="privacy-person" key={p.id}>
            <span>{p.name}</span>
            <button onClick={() => block(p)}>Block</button>
          </div>
        ))}
      <h3>Blocked people</h3>
      <p className="muted">
        Blocking pauses conversations you share. Existing history remains
        visible to members.
      </p>
      {blocks.map((p) => (
        <div className="privacy-person" key={p.id}>
          <span>{p.name}</span>
          <button onClick={() => block(p, true)}>Unblock</button>
        </div>
      ))}
      {!blocks.length && <p>No blocked people.</p>}
    </Modal>
  );
}
