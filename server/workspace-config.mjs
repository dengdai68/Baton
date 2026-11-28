import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  rmSync,
  linkSync,
} from "node:fs";
import { isIP } from "node:net";
import { isAbsolute, join } from "node:path";
import { createSecureContext } from "node:tls";
import { execFileSync } from "node:child_process";

export function provisionWorkspace(
  root,
  { mode, origin: address, port, bind = "127.0.0.1", cert: suppliedCert, key: suppliedKey },
) {
  const origin = new URL(address);
  if (
    !["cloud", "local"].includes(mode) ||
    !["https:", "http:"].includes(origin.protocol) ||
    origin.origin !== address ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !isIP(bind)
  )
    throw Error("无效的工作空间地址、监听 IP 或端口");
  if (!/^[a-zA-Z0-9.-]+$/.test(origin.hostname))
    throw Error("地址需要 IPv4 或域名");
  const supplied = suppliedCert !== undefined || suppliedKey !== undefined;
  if (supplied) {
    if (origin.protocol !== "https:" || !suppliedCert || !suppliedKey || !isAbsolute(suppliedCert) || !isAbsolute(suppliedKey))
      throw Error("HTTPS 证书链和私钥需要同时指定绝对路径");
    createSecureContext({cert: readFileSync(suppliedCert), key: readFileSync(suppliedKey)});
  }
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const info=lstatSync(root);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) || (process.getuid && info.uid!==process.getuid()))
    throw Error("请选择当前用户拥有的私有目录（权限 0700）");
  const file = join(root, "workspace-service.json");
  if (existsSync(file)) throw Error("工作空间已配置");
  const dir = mkdtempSync(join(root, "workspace-tls-"));
  try {
    const key = suppliedKey ?? join(dir, "key.pem"),
      cert = suppliedCert ?? join(dir, "cert.pem");
    if (origin.protocol === "https:" && !supplied) execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:3072",
        "-nodes",
        "-days",
        "365",
        "-subj",
        "/CN=" + origin.hostname,
        "-addext",
        "subjectAltName=" +
          (isIP(origin.hostname) ? "IP:" : "DNS:") +
          origin.hostname,
        "-keyout",
        key,
        "-out",
        cert,
      ],
      { stdio: "ignore", timeout: 15000 },
    );
    const config = {
      mode,
      origin: address,
      name: "Baton",
      bind,
      port,
      ...(origin.protocol === "https:" && {key, cert}),
    };
    const temp = join(dir, "config.json");
    writeFileSync(temp, JSON.stringify(config, null, 2), { mode: 0o600 });
    linkSync(temp, file);
    return config;
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}
export function workspaceOrigin(input) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.port === '0')
    throw Error('请输入有效的工作空间地址');
  return url.origin;
}
