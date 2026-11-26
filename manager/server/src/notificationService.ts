import net from 'node:net';

const SERVERDATA_AUTH = 3;
const SERVERDATA_AUTH_RESPONSE = 2;
const SERVERDATA_EXECCOMMAND = 2;

function encodeRconPacket(id: number, type: number, body: string): Buffer {
  const bodyBuf = Buffer.from(body, 'utf8');
  const size = 4 + 4 + bodyBuf.length + 2;
  const buf = Buffer.alloc(4 + size);
  buf.writeInt32LE(size, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  bodyBuf.copy(buf, 12);
  buf.writeInt16LE(0, 12 + bodyBuf.length);
  return buf;
}

export interface RconOptions {
  host: string;
  port: number;
  password: string;
  timeoutMs?: number;
}

/**
 * Native Source RCON TCP client (compatible with Valheim RCON BepInEx plugins).
 */
export function sendRconCommand(opts: RconOptions, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeoutMs = opts.timeoutMs ?? 5000;
    const socket = net.createConnection({ host: opts.host, port: opts.port });
    let authenticated = false;
    let settled = false;
    let recvBuf = Buffer.alloc(0);

    const finish = (err: Error | null, res = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(res);
    };

    const timer = setTimeout(() => {
      finish(new Error(`RCON connection to ${opts.host}:${opts.port} timed out`));
    }, timeoutMs);

    socket.on('error', (err) => finish(err));

    socket.on('connect', () => {
      socket.write(encodeRconPacket(1, SERVERDATA_AUTH, opts.password));
    });

    socket.on('data', (chunk) => {
      recvBuf = Buffer.concat([recvBuf, chunk]);
      while (recvBuf.length >= 4) {
        const pktSize = recvBuf.readInt32LE(0);
        if (recvBuf.length < 4 + pktSize) break;
        const pkt = recvBuf.subarray(4, 4 + pktSize);
        recvBuf = recvBuf.subarray(4 + pktSize);

        const reqId = pkt.readInt32LE(0);
        const type = pkt.readInt32LE(4);
        const body = pkt.subarray(8, Math.max(8, pkt.length - 2)).toString('utf8');

        if (!authenticated) {
          if (type === SERVERDATA_AUTH_RESPONSE) {
            if (reqId === -1) {
              finish(new Error('RCON authentication failed (invalid password)'));
              return;
            }
            authenticated = true;
            socket.write(encodeRconPacket(2, SERVERDATA_EXECCOMMAND, command));
          }
        } else if (reqId === 2) {
          finish(null, body);
          return;
        }
      }
    });
  });
}

export async function sendDiscordWebhook(
  webhookUrl: string,
  title: string,
  description: string,
  color = 0xf59e0b
): Promise<void> {
  if (!webhookUrl.trim()) return;
  const resp = await fetch(webhookUrl.trim(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'POK-Valheim',
      embeds: [
        {
          title,
          description,
          color,
          timestamp: new Date().toISOString(),
        },
      ],
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) {
    throw new Error(`Discord webhook returned HTTP ${resp.status}`);
  }
}
