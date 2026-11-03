import { ConnectedSocket, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { GameService } from './game.service.js';
import { validToken } from './auth.js';
import type { AdminCommand } from '@di-lam/shared';

@WebSocketGateway({ cors: { origin: false }, maxHttpBufferSize: 4096, serveClient: false })
export class GameGateway {
  @WebSocketServer() server!: Server;
  private timer?: NodeJS.Timeout;
  constructor(private readonly game: GameService) {}
  afterInit() { this.timer = setInterval(() => this.server.emit('game:state', this.game.snapshot()), 200); }
  handleConnection(socket: Socket) {
    const origin = socket.handshake.headers.origin;
    if (origin && ![process.env.WEB_ORIGIN || 'http://localhost:5174', 'http://127.0.0.1:5174', `http://localhost:${process.env.PORT || 3101}`, `http://127.0.0.1:${process.env.PORT || 3101}`, 'http://lvh.me:5174', `http://lvh.me:${process.env.PORT || 3101}`].includes(origin)) { socket.disconnect(true); return; }
    socket.emit('game:state', this.game.snapshot());
  }
  private admin(socket: Socket, command: AdminCommand) {
    if (!validToken(socket.handshake.auth.token)) return { ok: false, message: 'Admin token is required.' };
    const now = Date.now();
    if (now - Number(socket.data.lastCommand || 0) < 500) return { ok: false, message: 'Too many admin commands.' };
    socket.data.lastCommand = now;
    return this.game.control(command).catch(() => ({ ok: false, message: 'Không thể lưu trạng thái.' }));
  }
  @SubscribeMessage('admin:pause') pause(@ConnectedSocket() socket: Socket) { return this.admin(socket, 'pause'); }
  @SubscribeMessage('admin:resume') resume(@ConnectedSocket() socket: Socket) { return this.admin(socket, 'resume'); }
  @SubscribeMessage('admin:trigger-drama') drama(@ConnectedSocket() socket: Socket) { return this.admin(socket, 'drama'); }
  onModuleDestroy() { clearInterval(this.timer); }
}
