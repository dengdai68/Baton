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
import { chmodSync, statSync } from "node:fs";

const derive = promisify(scrypt);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
const day = 86400000;
const loginFailureLimit = 20;
const maxLoginFailurePairs = 10000;
const loginFailureKey = (name, address) => digest(JSON.stringify([name, address]));
export const localUser = "human_operator";
/** A device session ends after this long without use (sliding, renewed on use). */
export const deviceIdleMs = 30 * day;
/** Use is recorded (last seen, address, renewed expiry) at most this often per device. */
const touchIntervalMs = 60000;
/** Paired clients: "mobile" (phone, no configuration changes) or "desktop" (a Mac client). */
export const deviceScopes = Object.freeze(["mobile", "desktop"]);

export function workspaceIdentity(root, mode, administrator = null) {
  const path = join(root, "workspace-access.sqlite");
  const db = new DatabaseSync(path);
  // Token and password hashes stay private to the instance user.
  try { if ((statSync(path).mode & 0o777) !== 0o600) chmodSync(path, 0o600); } catch {}
  db.exec(`PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, name TEXT UNIQUE, salt TEXT, hash BLOB);
    CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, hash TEXT UNIQUE, member TEXT, label TEXT, expires INTEGER);
    CREATE TABLE IF NOT EXISTS invites (hash TEXT PRIMARY KEY, expires INTEGER);
    CREATE TABLE IF NOT EXISTS failures (name TEXT PRIMARY KEY, count INTEGER, since INTEGER);
    CREATE TABLE IF NOT EXISTS workspace_login_failures (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS workspace_login_expiry ON workspace_login_failures(expires);`);
  // Columns added for the device audit and scopes; existing rows keep working.
  const columns = (table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
  const ensure = (table, column, definition) => { if (!columns(table).has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); };
  ensure("devices", "accountVersion", "TEXT");
  ensure("devices", "created", "INTEGER");
  ensure("devices", "lastSeen", "INTEGER");
  ensure("devices", "lastAddress", "TEXT");
  ensure("devices", "scope", "TEXT NOT NULL DEFAULT 'mobile'");
  ensure("invites", "scope", "TEXT NOT NULL DEFAULT 'mobile'");
  // Sessions issued before this record held a fixed 30-day expiry from pairing.
  db.prepare("UPDATE devices SET created=expires-? WHERE created IS NULL").run(30 * day);
  const members = () =>
    mode === "local"
      ? [{ id: localUser, name: administrator?.administratorIdentity()?.name || "本机用户" }]
      : db.prepare("SELECT id,name FROM members ORDER BY name").all();
  const issue = (id, label, scope = "mobile", address = null, version = null) => {
    const now = Date.now();
    db.prepare("DELETE FROM devices WHERE expires<=?").run(now);
    const token = secret();
    db.prepare("INSERT INTO devices (id,hash,member,label,expires,created,lastSeen,lastAddress,scope,accountVersion) VALUES (?,?,?,?,?,?,?,?,?,?)").run(
      randomUUID(), digest(token), id, label, now + deviceIdleMs, now, now, address, scope, version,
    );
    return token;
  };
  return {
    members,
    loginRetryAfter(name, address) {
      const time = Date.now();
      const row = db.prepare("SELECT expires FROM workspace_login_failures WHERE key=? AND count>=? AND expires>?")
        .get(loginFailureKey(name, address), loginFailureLimit, time);
      return row ? Math.ceil((row.expires - time) / 1000) : 0;
    },
    recordLoginFailure(name, address) {
      const time = Date.now();
      db.prepare("DELETE FROM workspace_login_failures WHERE expires<=?").run(time);
      const key = loginFailureKey(name, address);
      const row = db.prepare(`
        INSERT INTO workspace_login_failures
        SELECT ?, 1, ?
        WHERE EXISTS (SELECT 1 FROM workspace_login_failures WHERE key=?)
           OR (SELECT count(*) FROM workspace_login_failures) < ?
        ON CONFLICT(key) DO UPDATE SET
          count = MIN(count+1, ?),
          expires = CASE WHEN count=? THEN excluded.expires ELSE expires END
        RETURNING count, expires
      `).get(key, time + day, key, maxLoginFailurePairs, loginFailureLimit, loginFailureLimit - 1);
      return row?.count >= loginFailureLimit ? Math.ceil((row.expires - time) / 1000) : 0;
    },
    clearLoginFailures(name, address) {
      db.prepare("DELETE FROM workspace_login_failures WHERE key=?").run(loginFailureKey(name, address));
    },
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
    async login(name, password, {label = "登录设备", scope = "mobile", address = null, canIssue = () => true} = {}) {
      if (mode === "local") {
        const owner = await administrator?.verifyAdministrator(name, password);
        return owner && canIssue() ? issue(localUser, label, scope, address, owner.version) : null;
      }
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
      if (!member || !timingSafeEqual(hash, member.hash) || !canIssue()) return null;
      db.prepare("DELETE FROM failures WHERE name=?").run(key);
      return issue(member.id, label, scope, address);
    },
    /** The member behind a token; use renews the idle expiry and records when and from where. */
    session(token, { address = null } = {}) {
      if (!token) return null;
      const now = Date.now();
      const row = db.prepare("SELECT id,member,scope,lastSeen,accountVersion FROM devices WHERE hash=? AND expires>?").get(digest(token), now);
      if (!row || (mode === "local" && (!row.accountVersion || row.accountVersion !== administrator?.administratorIdentity()?.version))) return null;
      if (!row.lastSeen || now - row.lastSeen >= touchIntervalMs)
        db.prepare("UPDATE devices SET lastSeen=?, expires=?, lastAddress=COALESCE(?,lastAddress) WHERE id=?").run(now, now + deviceIdleMs, address, row.id);
      const member = members().find((m) => m.id === row.member);
      return member && { ...member, deviceId: row.id, scope: row.scope || "mobile" };
    },
    accountDevices(member) {
      const version = mode === 'local' ? administrator?.administratorIdentity()?.version : null;
      return db.prepare('SELECT id,label,scope,created,lastSeen,lastAddress FROM devices WHERE member=? AND accountVersion IS ? AND expires>? ORDER BY lastSeen DESC').all(member, version ?? null, Date.now());
    },
    devices: () =>
      db.prepare("SELECT id,member,label,expires,created,lastSeen,lastAddress,scope FROM devices ORDER BY created").all(),
    revoke: (id) => db.prepare("DELETE FROM devices WHERE id=?").run(id),
    close: () => db.close(),
  };
}
