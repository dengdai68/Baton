import { openTunnel, readMessages, routePattern, sendMessage } from './relay-wire.mjs';

export function connectRelay(origin, identity, routes, accept) {
  let control, stopped = false, retry, heartbeat, delay = 500, revision = 0, ready = false, lastError = '';
  const sockets = new Set();
  function sync() {
    ready = false;
    if (control) sendMessage(control, {revision:++revision, routes:routes()});
  }
  async function dial() {
    try {
      const socket = await openTunnel(origin, 'control.baton.invalid:443', identity);
      if (stopped) return socket.destroy();
      control = socket;
      socket.setTimeout(70000, () => socket.destroy());
      readMessages(socket, msg => {
        if (msg.registered === revision) { ready = true; delay = 500; }
        if (!routePattern.test(msg.open) || !routePattern.test(msg.route)) return;
        if (!routes().some(entry => entry.id === msg.route)) return;
        void openTunnel(origin, msg.open + '.attach.invalid:443', identity).then(stream => {
          if (control !== socket || !routes().some(entry => entry.id === msg.route)) return stream.destroy();
          sockets.add(stream);
          stream.once('close', () => sockets.delete(stream));
          accept(msg.route, stream);
        }).catch(() => {});
      });
      heartbeat = setInterval(() => sendMessage(socket, {ping:true}), 25000);
      socket.once('close', () => {
        clearInterval(heartbeat); ready = false; control = null;
        for (const stream of sockets) stream.destroy();
        schedule();
      });
      sync();
    } catch (error) { lastError = error.code || error.message; schedule(); }
  }
  function schedule() {
    if (stopped) return;
    retry = setTimeout(dial, delay);
    delay = Math.min(15000, delay * 2);
  }
  void dial();
  return {sync, get error() { return lastError; }, get ready() {return ready;}, close() {
    stopped = true; clearTimeout(retry); clearInterval(heartbeat); control?.destroy();
    for (const stream of sockets) stream.destroy();
  }};
}
