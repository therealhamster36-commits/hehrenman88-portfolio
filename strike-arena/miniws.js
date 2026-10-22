'use strict';
const crypto = require('crypto');
const { EventEmitter } = require('events');
const ACCEPT_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class MiniSocket extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.readyState = 1;
    this.fragments = [];
    socket.on('data', chunk => this.handleData(chunk));
    socket.on('close', () => { this.readyState = 3; this.emit('close'); });
    socket.on('error', e => { this.emit('error', e); });
  }
  frame(opcode, payload = Buffer.alloc(0)) {
    if (this.readyState !== 1) return;
    const length = payload.length;
    let head;
    if (length < 126) { head = Buffer.from([0x80 | opcode, length]); }
    else if (length < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(length, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(length), 2); }
    this.socket.write(Buffer.concat([head, payload]));
  }
  send(value) { this.frame(1, Buffer.from(String(value))); }
  close() { if (this.readyState === 1) { this.frame(8); this.socket.end(); } }
  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > 1_000_000) return this.socket.destroy();
    while (this.buffer.length >= 2) {
      const a = this.buffer[0], b = this.buffer[1];
      const fin = !!(a & 0x80), opcode = a & 15;
      const masked = !!(b & 0x80);
      let length = b & 127, offset = 2;
      if (!masked) { this.socket.destroy(); return; }
      if (length === 126) { if (this.buffer.length < 4) return; length = this.buffer.readUInt16BE(2); offset = 4; }
      else if (length === 127) {
        if (this.buffer.length < 10) return;
        const large = this.buffer.readBigUInt64BE(2);
        if (large > 2048n) { this.socket.destroy(); return; }
        length = Number(large); offset = 10;
      }
      if (length > 2048 && opcode < 8) { this.socket.destroy(); return; }
      if (this.buffer.length < offset + 4 + length) return;
      const mask = this.buffer.subarray(offset, offset + 4);
      const payload = Buffer.from(this.buffer.subarray(offset + 4, offset + 4 + length));
      for (let i = 0; i < length; i++) payload[i] ^= mask[i % 4];
      this.buffer = this.buffer.subarray(offset + 4 + length);
      if (opcode === 8) { this.close(); return; }
      if (opcode === 9) { this.frame(10, payload); continue; }
      if (opcode === 10) continue;
      if (opcode === 1 && fin) { this.emit('message', payload); continue; }
      if (opcode === 0 || opcode === 1) {
        this.fragments.push(payload);
        if (fin) { this.emit('message', Buffer.concat(this.fragments)); this.fragments = []; }
      }
    }
  }
}
function installWebSocketServer(server, pathname, onConnection) {
  server.on('upgrade', (req, socket, head) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const key = req.headers['sec-websocket-key'];
      if (url.pathname !== pathname || req.headers.upgrade?.toLowerCase() !== 'websocket' || typeof key !== 'string') {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n'); socket.destroy(); return;
      }
      const accept = crypto.createHash('sha1').update(key + ACCEPT_GUID).digest('base64');
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
      const client = new MiniSocket(socket);
      onConnection(client);
      if (head?.length) client.handleData(head);
    } catch { socket.destroy(); }
  });
}
module.exports = { installWebSocketServer };
