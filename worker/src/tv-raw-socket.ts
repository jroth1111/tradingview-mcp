import { connect } from "cloudflare:sockets";

const ORIGIN = "https://www.tradingview.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

const secWebSocketKey = () => {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return toBase64(buf);
};

const secWebSocketAccept = async (key: string) => {
  const data = encoder.encode(key + GUID);
  const hash = await crypto.subtle.digest("SHA-1", data);
  return toBase64(new Uint8Array(hash));
};

const findCrlfCrlf = (buf: Uint8Array) => {
  for (let i = 0; i < buf.length - 3; i++) {
    if (
      buf[i] === 13 &&
      buf[i + 1] === 10 &&
      buf[i + 2] === 13 &&
      buf[i + 3] === 10
    ) {
      return i;
    }
  }
  return -1;
};

type Frame =
  | { opcode: 0x1; payload: Uint8Array; consumed: number } // text
  | { opcode: 0x2; payload: Uint8Array; consumed: number } // binary (unused)
  | { opcode: 0x8; payload: Uint8Array; consumed: number } // close
  | { opcode: 0x9; payload: Uint8Array; consumed: number } // ping
  | { opcode: 0xa; payload: Uint8Array; consumed: number }; // pong

export interface RawWebSocketOptions {
  sessionId?: string;
  headers?: Record<string, string>;
  debug?: boolean;
}

export class RawWebSocket {
  private url: URL;
  private opts: RawWebSocketOptions;
  private socket: any | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private buffer = new Uint8Array(0);
  private closed = false;

  onText?: (text: string) => void;
  onClose?: (err?: any) => void;
  onError?: (err: any) => void;

  constructor(url: string, opts: RawWebSocketOptions = {}) {
    this.url = new URL(url);
    this.opts = opts;
  }

  async connect(timeoutMs: number = 10_000) {
    const isSecure = this.url.protocol === "wss:";
    const port = this.url.port ? parseInt(this.url.port, 10) : isSecure ? 443 : 80;

    this.socket = connect(
      { hostname: this.url.hostname, port },
      { secureTransport: isSecure ? "on" : "off", allowHalfOpen: false },
    );

    this.writer = this.socket.writable.getWriter();
    this.reader = this.socket.readable.getReader();

    const key = secWebSocketKey();
    const path = `${this.url.pathname || "/"}${this.url.search || ""}`;
    const headers: Record<string, string> = {
      Host: this.url.host,
      Upgrade: "websocket",
      Connection: "Upgrade",
      "Sec-WebSocket-Key": key,
      "Sec-WebSocket-Version": "13",
      Origin: ORIGIN,
      "User-Agent": UA,
      Pragma: "no-cache",
      "Cache-Control": "no-cache",
      ...(this.opts.sessionId ? { Cookie: `sessionid=${this.opts.sessionId}` } : {}),
      ...(this.opts.headers || {}),
    };

    const request =
      `GET ${path} HTTP/1.1\r\n` +
      Object.entries(headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\r\n") +
      "\r\n\r\n";

    const writer = this.writer;
    const reader = this.reader;
    if (!writer || !reader) throw new Error("Socket streams unavailable");

    await writer.write(encoder.encode(request));

    const deadline = Date.now() + timeoutMs;
    let headerBuf = new Uint8Array(0);

    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error("Connection closed during handshake");
      if (!value) continue;
      headerBuf = RawWebSocket.concat(headerBuf, value);
      const idx = findCrlfCrlf(headerBuf);
      if (idx === -1) {
        if (Date.now() > deadline) throw new Error("Handshake timeout");
        continue;
      }

      const headerBytes = headerBuf.slice(0, idx);
      const leftover = headerBuf.slice(idx + 4);
      const headerText = decoder.decode(headerBytes);
      const statusLine = headerText.split("\r\n")[0] || "";
      if (!statusLine.startsWith("HTTP/1.1 101")) {
        throw new Error(`Handshake failed: ${statusLine}`);
      }

      const acceptLine = headerText
        .split("\r\n")
        .find((h) => h.toLowerCase().startsWith("sec-websocket-accept"));
      if (acceptLine) {
        const valuePart = acceptLine.split(":")[1]?.trim();
        const expected = await secWebSocketAccept(key);
        if (valuePart && valuePart !== expected) {
          throw new Error("Invalid Sec-WebSocket-Accept");
        }
      }

      if (leftover.length) {
        this.appendBuffer(leftover);
      }
      break;
    }

    // Start read loop
    this.closed = false;
    this.readLoop().catch((err) => this.onError?.(err));
  }

  async sendText(payload: string, opcode: number = 0x1) {
    if (!this.writer) throw new Error("Socket not connected");
    const frame = this.encodeFrame(encoder.encode(payload), opcode);
    await this.writer.write(frame);
  }

  async sendBinary(payload: Uint8Array, opcode: number = 0x2) {
    if (!this.writer) throw new Error("Socket not connected");
    const frame = this.encodeFrame(payload, opcode);
    await this.writer.write(frame);
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.sendText("", 0x8);
    } catch {
      // ignore send errors on close
    }
    try {
      await this.writer?.close();
    } catch {
      // ignore
    }
    try {
      await this.reader?.cancel();
    } catch {
      // ignore
    }
    try {
      this.socket?.close();
    } catch {
      // ignore
    }
    this.onClose?.();
  }

  private async readLoop() {
    while (!this.closed) {
      // Drain any buffered frames first
      await this.drainFrames();
      if (this.closed) break;

      const { value, done } = await this.reader!.read();
      if (done) break;
      if (value && value.length) {
        this.appendBuffer(value);
      }
    }
    if (!this.closed) this.onClose?.();
  }

  private async drainFrames() {
    while (true) {
      const frame = this.nextFrame();
      if (!frame) break;

      switch (frame.opcode) {
        case 0x1: {
          const text = decoder.decode(frame.payload);
          this.onText?.(text);
          break;
        }
        case 0x9: {
          // Ping -> Pong with same payload
          await this.sendBinary(frame.payload, 0xa);
          break;
        }
        case 0x8: {
          this.closed = true;
          break;
        }
        default:
          break;
      }
    }
  }

  private nextFrame(): Frame | null {
    if (this.buffer.length < 2) return null;
    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
    const first = view.getUint8(0);
    const second = view.getUint8(1);
    const fin = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let len = second & 0x7f;
    let offset = 2;

    if (len === 126) {
      if (this.buffer.length < 4) return null;
      len = view.getUint16(2, false);
      offset = 4;
    } else if (len === 127) {
      if (this.buffer.length < 10) return null;
      const big = view.getBigUint64(2, false);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("Frame too large");
      }
      len = Number(big);
      offset = 10;
    }

    const maskOffset = offset;
    if (masked) offset += 4;

    const totalLen = offset + len;
    if (this.buffer.length < totalLen) return null;

    let payload = this.buffer.slice(offset, offset + len);
    if (masked) {
      const mask = this.buffer.slice(maskOffset, maskOffset + 4);
      for (let i = 0; i < payload.length; i++) {
        payload[i] = payload[i] ^ mask[i % 4];
      }
    }

    const consumed = totalLen;
    this.buffer = this.buffer.slice(consumed);

    if (!fin) {
      throw new Error("Fragmented frames not supported for this upstream");
    }

    if (opcode === 0x1 || opcode === 0x2 || opcode === 0x8 || opcode === 0x9 || opcode === 0xa) {
      return { opcode, payload, consumed } as Frame;
    }
    return { opcode: 0x2, payload, consumed }; // treat as binary/ignore
  }

  private encodeFrame(payload: Uint8Array, opcode: number): Uint8Array {
    const len = payload.length;
    let headerLen = 2;
    if (len > 125 && len <= 65535) headerLen = 4;
    else if (len > 65535) headerLen = 10;

    const totalLen = headerLen + 4 + len; // mask always set for client frames
    const frame = new Uint8Array(totalLen);
    const view = new DataView(frame.buffer);

    view.setUint8(0, 0x80 | (opcode & 0x0f));
    if (len <= 125) {
      view.setUint8(1, 0x80 | len);
    } else if (len <= 65535) {
      view.setUint8(1, 0x80 | 126);
      view.setUint16(2, len, false);
    } else {
      view.setUint8(1, 0x80 | 127);
      view.setBigUint64(2, BigInt(len), false);
    }

    const maskStart = headerLen;
    const maskKey = frame.subarray(maskStart, maskStart + 4);
    crypto.getRandomValues(maskKey);

    const payloadStart = headerLen + 4;
    for (let i = 0; i < len; i++) {
      frame[payloadStart + i] = payload[i] ^ maskKey[i % 4];
    }
    return frame;
  }

  private appendBuffer(chunk: Uint8Array) {
    this.buffer = RawWebSocket.concat(this.buffer, chunk);
  }

  private static concat(a: Uint8Array, b: Uint8Array) {
    const merged = new Uint8Array(a.length + b.length);
    merged.set(a);
    merged.set(b, a.length);
    return merged;
  }
}
