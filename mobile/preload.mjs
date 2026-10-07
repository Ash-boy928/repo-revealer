// Mobile-only startup shim. Loaded BEFORE the unchanged bot server.
// It never edits bot logic; it only makes the server listen on the phone's
// private loopback address so other devices on the same WiFi cannot open it.
import net from 'net';

if (process.env.LEO_MOBILE === '1') {
  const host = process.env.LEO_HOST || '127.0.0.1';
  const orig = net.Server.prototype.listen;
  net.Server.prototype.listen = function (...args) {
    if (typeof args[0] === 'number' && (args[1] === '0.0.0.0' || args[1] === '::')) {
      args[1] = host;
    }
    return orig.apply(this, args);
  };
}
