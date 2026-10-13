export const schema = `
CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY,handle TEXT NOT NULL UNIQUE,name TEXT NOT NULL,bio TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS profile_handle_ci ON profiles(lower(handle));
CREATE TABLE IF NOT EXISTS conversations(id UUID PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('direct','group')),title TEXT NOT NULL DEFAULT '',owner_id TEXT NOT NULL REFERENCES profiles(id),direct_key TEXT UNIQUE,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS members(conversation_id UUID NOT NULL REFERENCES conversations(id),user_id TEXT NOT NULL REFERENCES profiles(id),last_read_id BIGINT NOT NULL DEFAULT 0,joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(conversation_id,user_id));
CREATE TABLE IF NOT EXISTS photos(id UUID PRIMARY KEY,conversation_id UUID NOT NULL REFERENCES conversations(id),owner_id TEXT NOT NULL REFERENCES profiles(id),object_key TEXT NOT NULL UNIQUE,bytes INTEGER NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN ('uploading','ready','failed')),created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS messages(id BIGSERIAL PRIMARY KEY,conversation_id UUID NOT NULL REFERENCES conversations(id),sender_id TEXT NOT NULL REFERENCES profiles(id),client_id UUID NOT NULL,text TEXT NOT NULL DEFAULT '',photo_id UUID UNIQUE REFERENCES photos(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),deleted_at TIMESTAMPTZ,UNIQUE(conversation_id,sender_id,client_id),CHECK(length(text)<=4000));
CREATE INDEX IF NOT EXISTS messages_history ON messages(conversation_id,id DESC);
CREATE TABLE IF NOT EXISTS blocks(blocker_id TEXT NOT NULL REFERENCES profiles(id),blocked_id TEXT NOT NULL REFERENCES profiles(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(blocker_id,blocked_id),CHECK(blocker_id<>blocked_id));
CREATE TABLE IF NOT EXISTS reports(id UUID PRIMARY KEY,reporter_id TEXT NOT NULL REFERENCES profiles(id),message_id BIGINT NOT NULL REFERENCES messages(id),reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(reporter_id,message_id));
CREATE TABLE IF NOT EXISTS revoked_tokens(hash TEXT PRIMARY KEY,expires_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS account_revocations(user_id TEXT PRIMARY KEY REFERENCES profiles(id),issued_through BIGINT NOT NULL);
`;
