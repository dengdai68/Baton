import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { provisionWorkspace } from "./workspace-config.mjs";
import { workspaceIdentity } from "./workspace-identity.mjs";
import { createAuth } from "./auth.mjs";

import { readStorageLocation } from "./storage-layout.mjs";

process.umask(0o077);
const [command, where, ...args] = process.argv.slice(2);
if (!where || command === "help") {
  console.log(
    "workspace init DIR local|cloud HTTP(S)_ORIGIN [PORT] [BIND]\nworkspace serve DIR\nworkspace member DIR NAME < password-file\nworkspace operator DIR NAME < password-file\nworkspace devices DIR\nworkspace revoke DIR DEVICE_ID",
  );
  process.exit(command === "help" ? 0 : 2);
}
const root = resolve(where),
  file = join(root, "workspace-service.json");
if (command === "init") {
  const [mode, address, portArg = "9443", bind = "127.0.0.1"] = args,
    port = Number(portArg);
  provisionWorkspace(root, { mode, origin: address, port, bind });
  console.log(file);
} else {
  const config = JSON.parse(readFileSync(file));
  if (command === "serve") {
    // A private fork keeps exactly the same Store / runtime bootstrap as Electron.
    const location = await readStorageLocation(root, {
      version: 1,
      workspaceRoot: join(root, "workspace"),
    });
    const child = fork(
      fileURLToPath(new URL("./index.mjs", import.meta.url)),
      [],
      {
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              ([key]) => !key.startsWith("BATON_"),
            ),
          ),
          BATON_DESKTOP_CONTROL_ROOT: root,
          BATON_WORKSPACE_ROOT: location.workspaceRoot,
          BATON_DESKTOP_PORT: "0",
          BATON_BOOTSTRAP_TOKEN: randomBytes(32).toString("hex"),
          BATON_WORKSPACE_DAEMON: "1",
        },
        stdio: ["ignore", "inherit", "inherit", "ipc"],
      },
    );
    child.on("message", (message) => {
      if (message?.type !== "baton-ready") return;
      const path = join(root, "desktop-endpoint.json"),
        tmp = path + "." + process.pid;
      writeFileSync(
        tmp,
        JSON.stringify({
          origin: "http://127.0.0.1:" + message.port,
          instanceId: message.instanceId,
        }),
        { mode: 0o600 },
      );
      renameSync(tmp, path);
    });
    for (const sig of ["SIGINT", "SIGTERM"])
      process.once(sig, () => child.kill(sig));
    child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
  } else if (command === "operator") {
    const auth = createAuth({
      databasePath: join(root, "auth.sqlite"),
      origins: [],
    });
    if (auth.configured()) throw Error("本机管理账号已经存在");
    await auth.setAdministrator(
      args[0],
      readFileSync(0, "utf8").replace(/\r?\n$/, ""),
    );
  } else {
    const identity = workspaceIdentity(root, config.mode);
    try {
      if (command === "member")
        await identity.add(
          args[0],
          readFileSync(0, "utf8").replace(/\r?\n$/, ""),
        );
      else if (command === "devices")
        console.log(JSON.stringify(identity.devices(), null, 2));
      else if (command === "revoke") identity.revoke(args[0]);
      else throw Error("未知命令");
    } finally {
      identity.close();
    }
  }
}
