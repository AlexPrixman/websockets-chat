export type Person = {
  id: string;
  name: string;
  handle: string;
  bio: string;
  moderator?: boolean;
};
export type Conversation = {
  id: string;
  kind: "direct" | "group";
  title: string;
  members: Person[];
  unread: number;
  blocked: boolean;
  lastMessage: string;
  updatedAt: string;
};
export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  clientId: string;
  text: string;
  deletedAt: string | null;
  createdAt: string;
  photo: null | { id: string; width: number; height: number };
};
export const titleOf = (c: Conversation, me: string) =>
  c.kind === "group"
    ? c.title
    : c.members.find((p) => p.id !== me)?.name || "Conversation";
export const mergeMessages = (old: Message[], incoming: Message[]) =>
  [...new Map([...old, ...incoming].map((m) => [m.id, m])).values()].sort(
    (a, b) =>
      BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0,
  );
