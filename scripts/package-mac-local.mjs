#!/usr/bin/env node
// Local install build (`npm run package:mac:local`): the same app as
// `npm run package:mac`, but an unpacked .app signed with a stable identity from
// the login keychain instead of ad hoc. macOS ties file-access grants (an external
// data volume, Full Disk Access) to the code signature; an ad-hoc signature changes
// with every build, so each reinstall silently revoked them and the service hung
// waiting for permission. Release builds keep their own flow (CONTRIBUTING).
//
// BATON_SIGN_IDENTITY selects an identity (SHA-1 or full name) when the keychain
// holds several. Output: release/mac-arm64/Baton.app.
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { renameSync, rmSync } from "node:fs";
import { join } from "node:path";

const signingKinds = ["Developer ID Application:", "Apple Development:"];

/** Pick the signing identity from `security find-identity -v -p codesigning` output. */
export function chooseSigningIdentity(listing, requested = "") {
  const identities = [...String(listing).matchAll(/^\s*\d+\)\s+([0-9A-F]{40})\s+"([^"]+)"/gm)].map(([, hash, name]) => ({ hash, name }));
  if (requested) {
    const wanted = requested.trim();
    const match = identities.find((identity) => identity.hash === wanted.toUpperCase() || identity.name === wanted);
    if (!match) throw new Error(`钥匙串中没有有效的签名身份「${wanted}」`);
    return match;
  }
  const usable = identities.filter((identity) => signingKinds.some((kind) => identity.name.startsWith(kind)));
  if (usable.length === 1) return usable[0];
  if (!usable.length) throw new Error("钥匙串中没有 Apple Development 或 Developer ID Application 签名身份：请在 Xcode 登录 Apple 账号生成开发证书，或改用 npm run package:mac（ad-hoc，每次重装需重新授权文件访问）");
  throw new Error(`钥匙串中有多个签名身份，请用 BATON_SIGN_IDENTITY 指定其一：\n${usable.map((identity) => `  ${identity.hash}  ${identity.name}`).join("\n")}`);
}

/** Build release/mac-arm64/Baton.app signed with the chosen identity. */
function main() {
  if (process.platform !== "darwin") throw new Error("本机签名构建只支持 macOS");
  const listing = execFileSync("/usr/bin/security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" });
  const identity = chooseSigningIdentity(listing, process.env.BATON_SIGN_IDENTITY || "");
  console.log(`签名身份：${identity.name}（${identity.hash}）`);
  const output = join("release", "mac-local-build");
  // A previous build that crashed between "copying unpacked Electron" and rename leaves a
  // half-written Electron.app in mac-arm64/; electron-builder then fails with
  // "corrupted Electron dist". Build into a fresh directory and rename the result.
  rmSync(output, { recursive: true, force: true });
  const builder = spawnSync("npx", ["electron-builder", "--mac", "--arm64", "--dir", "--publish", "never", `-c.mac.identity=${identity.hash}`, "-c.directories.output=" + output], { stdio: "inherit" });
  if (builder.status !== 0) throw new Error(`electron-builder 失败（退出码 ${builder.status}）`);
  const app = join(output, "mac-arm64", "Baton.app");
  const details = spawnSync("/usr/bin/codesign", ["-dv", "--verbose=2", app], { encoding: "utf8" }).stderr;
  if (!details.includes(`Authority=${identity.name}`)) throw new Error(`${app} 未使用所选身份签名：\n${details}`);
  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
  rmSync("release/mac-arm64", { recursive: true, force: true });
  renameSync(join(output, "mac-arm64"), "release/mac-arm64");
  rmSync(output, { recursive: true, force: true });
  console.log(`已构建并验证签名：release/mac-arm64/Baton.app`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exit(1); }
}
