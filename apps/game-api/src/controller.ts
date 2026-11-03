import { BadRequestException, Body, Controller, Get, HttpCode, Logger, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { validInput } from '@di-lam/shared';
import type { AdminCommand } from '@di-lam/shared';
import { SPEECH_SAMPLES, type SpeechSample } from './engine.js';
import { GameService } from './game.service.js';
import { TikTokService } from './tiktok.service.js';
import { TtsService } from './tts.js';
import { AdminGuard } from './auth.js';

@Controller('api')
export class GameController {
  private readonly logger = new Logger('Api');
  constructor(private readonly game: GameService, private readonly tiktok: TikTokService, private readonly tts: TtsService) {}
  @Get('health') health() { return { ok: true, storage: this.game.store.mode }; }
  @Get('state') state() { return this.game.snapshot(); }
  @Post('admin/command') @HttpCode(200) @UseGuards(AdminGuard)
  command(@Body() body: unknown) {
    const command = (body as { command?: unknown } | null)?.command;
    if (typeof command !== 'string' || !['pause', 'resume', 'drama', 'seed', 'reset'].includes(command)) throw new BadRequestException('Lệnh quản trị không hợp lệ.');
    return this.game.control(command as AdminCommand);
  }
  @Post('admin/simulate') @HttpCode(200) @UseGuards(AdminGuard)
  simulate(@Body() body: unknown) {
    const event = { ...(body && typeof body === 'object' ? body : {}), source: 'simulator', roomId: this.game.roomId, timestamp: Date.now() };
    if (!validInput(event)) throw new BadRequestException('Sự kiện không hợp lệ.');
    return this.game.submit(event);
  }
  /** Operator settings patch (validated by the engine; an invalid patch changes nothing). */
  @Post('admin/settings') @HttpCode(200) @UseGuards(AdminGuard)
  settings(@Body() body: unknown) { return this.game.updateSettings(body); }
  /** "Đọc ngay" `{ text }` or "nghe thử" `{ sample: 'greet' | 'gift' | 'follow' | 'share' }`. */
  @Post('admin/speak') @HttpCode(200) @UseGuards(AdminGuard)
  speak(@Body() body: unknown) {
    const { text, sample } = (body && typeof body === 'object' ? body : {}) as { text?: unknown; sample?: unknown };
    if (sample !== undefined) {
      if (typeof sample !== 'string' || !SPEECH_SAMPLES.includes(sample as SpeechSample)) throw new BadRequestException('Mẫu câu không hợp lệ.');
      return this.game.speakSample(sample as SpeechSample);
    }
    if (typeof text !== 'string') throw new BadRequestException('Chưa nhập nội dung cần đọc.');
    return this.game.speak(text);
  }
  /**
   * Audio for one spoken line, by id. Public (the OBS stage page has no admin token) but only lines the server
   * itself queued can be synthesized, so this is not an open text-to-speech proxy.
   */
  @Get('tts/:id')
  async speech(@Param('id') id: string, @Res() response: Response) {
    const line = /^\d{1,12}$/.test(id) ? this.game.speechLine(Number(id)) : undefined;
    if (!line) { response.status(404).json({ message: 'Câu đọc không tồn tại hoặc đã hết hạn.' }); return; }
    const { voiceGender, voiceRate } = this.game.settings;
    try {
      const audio = await this.tts.synthesize(line.text, voiceGender, voiceRate);
      response.setHeader('Content-Type', 'audio/mpeg');
      response.setHeader('Cache-Control', 'private, max-age=600');
      response.send(audio);
    } catch (error) {
      this.logger.warn(`TTS failed: ${error instanceof Error ? error.message : String(error)}`);
      response.status(502).json({ message: 'Không tạo được giọng đọc (cần internet).' });
    }
  }
  @Post('admin/tiktok/connect') @HttpCode(200) @UseGuards(AdminGuard)
  connect(@Body() body: unknown) { return this.tiktok.connect((body as { username?: unknown } | null)?.username); }
  @Post('admin/tiktok/disconnect') @HttpCode(200) @UseGuards(AdminGuard)
  disconnect() { return this.tiktok.disconnect(); }
}
