import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  createHash,
  scrypt,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import { promisify } from "node:util";
import { join } from "node:path";

const derive = promisify(scrypt);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
const day = 86400000;
export const localUser = "human_operator";

export function workspaceIdentity(root, mode) {
  const db = new DatabaseSync(join(root, "workspace-access.sqlite"));
  db.exec(`PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, name TEXT UNIQUE, salt TEXT, hash BLOB);
    CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, hash TEXT UNIQUE, member TEXT, label TEXT, expires INTEGER);
    CREATE TABLE IF NOT EXISTS invites (hash TEXT PRIMARY KEY, expires INTEGER);
    CREATE TABLE IF NOT EXISTS failures (name TEXT PRIMARY KEY, count INTEGER, since INTEGER);`);
  const members = () =>
    mode === "local"
      ? [{ id: localUser, name: "本机用户" }]
      : db.prepare("SELECT id,name FROM members ORDER BY name").all();
  const issue = (id, label) => {
    db.prepare("DELETE FROM devices WHERE expires<=?").run(Date.now());
    const token = secret();
    db.prepare("INSERT INTO devices VALUES (?,?,?,?,?)").run(
      randomUUID(),
      digest(token),
      id,
      label,
      Date.now() + 30 * day,
    );
    return token;
  };
  return {
    members,
    async add(name, password) {
      if (
        mode !== "cloud" ||
        typeof name !== "string" ||
        !name.trim() ||
        name !== name.trim() ||
        name.length > 80 ||
        typeof password !== "string" ||
        password.length < 10 ||
        password.length > 128
      )
        throw Error("需要云端用户名与 10–128 位密码");
      const salt = secret(),
        hash = await derive(password, salt, 64);
      db.prepare("INSERT INTO members VALUES (?,?,?,?)").run(
        randomUUID(),
        name,
        salt,
        hash,
      );
    },
    async login(name, password) {
      if (
        mode !== "cloud" ||
        typeof name !== "string" ||
        typeof password !== "string" ||
        password.length > 128
      )
        return null;
      const member = db.prepare("SELECT * FROM members WHERE name=?").get(name);
      const key = member?.id || "unknown",
        now = Date.now();
      db.prepare("DELETE FROM failures WHERE since < ?").run(now - 600000);
      const count = db
        .prepare(
          "INSERT INTO failures VALUES (?,1,?) ON CONFLICT(name) DO UPDATE SET count=count+1 RETURNING count",
        )
        .get(key, now).count;
      if (count > 10) return null;
      const hash = await derive(
        password,
        member?.salt || "unknown-account",
        64,
      );
      if (!member || !timingSafeEqual(hash, member.hash)) return null;
      db.prepare("DELETE FROM failures WHERE name=?").run(key);
      return issue(member.id, "登录设备");
    },
    invite() {
      if (mode !== "local") throw Error("仅本地模式允许配对");
      const token = secret();
      db.prepare("DELETE FROM invites WHERE expires<=?").run(Date.now());
      db.prepare("INSERT INTO invites VALUES (?,?)").run(
        digest(token),
        Date.now() + 300000,
      );
      return token;
    },
    /** Redeem a one-time invite for a device session; label names it in the device list. */
    pair(token, label = "iOS") {
      if (mode !== "local" || typeof token !== "string") return null;
      if (
        !db
          .prepare(
            "DELETE FROM invites WHERE hash=? AND expires>? RETURNING hash",
          )
          .get(digest(token), Date.now())
      )
        return null;
      return issue(localUser, label);
    },
    session(token) {
      if (!token) return null;
      const row = db
        .prepare("SELECT id,member FROM devices WHERE hash=? AND expires>?")
        .get(digest(token), Date.now());
      if (!row) return null;
      const member = members().find((m) => m.id === row.member);
      return member && { ...member, deviceId: row.id };
    },
    devices: () =>
      db.prepare("SELECT id,member,label,expires FROM devices").all(),
    revoke: (id) => db.prepare("DELETE FROM devices WHERE id=?").run(id),
    close: () => db.close(),
  };
}
