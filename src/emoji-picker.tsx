import { useEffect, useRef, useState } from "react";
import { Smile, X } from "lucide-react";

const groups = [
  {
    name: "Faces",
    items: [
      ["😀", "grinning face"], ["😃", "smiling face"], ["😄", "smiling eyes"],
      ["😁", "beaming face"], ["😅", "nervous laugh"], ["😂", "tears of joy"],
      ["🤣", "rolling laughing"], ["😊", "blushing smile"], ["🥰", "smiling hearts"],
      ["😍", "heart eyes"], ["😘", "face blowing kiss"], ["😎", "cool face"],
      ["🥳", "party face"], ["🤔", "thinking face"], ["😴", "sleeping face"],
      ["😢", "crying face"], ["😭", "loudly crying face"], ["😮", "surprised face"],
      ["😡", "angry face"], ["🫶", "heart hands"],
    ],
  },
  {
    name: "Gestures",
    items: [
      ["👋", "waving hand"], ["👍", "thumbs up"], ["👎", "thumbs down"],
      ["👏", "clapping hands"], ["🙌", "raising hands"], ["🙏", "folded hands"],
      ["🤝", "handshake"], ["👌", "okay hand"], ["✌️", "victory hand"],
      ["💪", "flexed biceps"], ["👀", "eyes"], ["💃", "dancing"],
    ],
  },
  {
    name: "Hearts & symbols",
    items: [
      ["❤️", "red heart"], ["🧡", "orange heart"], ["💛", "yellow heart"],
      ["💚", "green heart"], ["💙", "blue heart"], ["💜", "purple heart"],
      ["🤍", "white heart"], ["💔", "broken heart"], ["✨", "sparkles"],
      ["🔥", "fire"], ["💯", "hundred points"], ["🎉", "confetti"],
      ["⭐", "star"], ["✅", "check mark"], ["💬", "speech bubble"],
    ],
  },
  {
    name: "Everyday",
    items: [
      ["☀️", "sun"], ["🌙", "moon"], ["🌈", "rainbow"],
      ["🌸", "flower"], ["🐶", "dog"], ["🐱", "cat"],
      ["☕", "coffee"], ["🍕", "pizza"], ["🍰", "cake"],
      ["🎂", "birthday cake"], ["🎁", "gift"], ["🎵", "music note"],
      ["🏖️", "beach"], ["🚗", "car"], ["💡", "light bulb"],
    ],
  },
] as const;

export function insertEmoji(
  text: string,
  start: number,
  end: number,
  emoji: string,
  maxLength = 4000,
) {
  const next = text.slice(0, start) + emoji + text.slice(end);
  return next.length <= maxLength ? { text: next, caret: start + emoji.length } : null;
}

export function EmojiPicker({
  disabled,
  onSelect,
}: {
  disabled: boolean;
  onSelect: (emoji: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const matching = groups.map((group) => ({
    name: group.name,
    items: group.items.filter(([, label]) => label.includes(search.trim().toLowerCase())),
  })).filter((group) => group.items.length);

  return (
    <div className="emoji-picker" ref={root}>
      <button
        ref={trigger}
        className="emoji-trigger"
        type="button"
        aria-label="Choose emoji"
        aria-expanded={open}
        aria-controls="emoji-panel"
        title="Choose emoji"
        disabled={disabled}
        onClick={() => {
          setOpen((value) => !value);
          setSearch("");
        }}
      ><Smile size={20} /></button>
      {open && (
        <div id="emoji-panel" className="emoji-panel" aria-label="Emoji picker">
          <div className="emoji-panel-head">
            <strong>Choose an emoji</strong>
            <button type="button" aria-label="Close emoji picker" onClick={() => setOpen(false)}><X size={17} /></button>
          </div>
          <input
            type="search"
            aria-label="Search emoji"
            placeholder="Search emoji"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
          />
          <div className="emoji-groups">
            {matching.map((group) => (
              <section key={group.name}>
                <h3>{group.name}</h3>
                <div className="emoji-grid">
                  {group.items.map(([emoji, label]) => (
                    <button
                      key={label}
                      type="button"
                      aria-label={`Add ${label} emoji`}
                      title={label}
                      onClick={() => { if (onSelect(emoji)) setOpen(false); }}
                    ><span aria-hidden="true">{emoji}</span></button>
                  ))}
                </div>
              </section>
            ))}
            {!matching.length && <p>No emoji found.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
