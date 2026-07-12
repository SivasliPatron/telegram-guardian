import { describe, expect, it } from 'vitest';
import {
  audioWithinModerationLimits,
  finalizePipeWavHeader,
  readAudioResponseBuffer,
} from '../src/services/audio.js';

const limits = { maxDurationSeconds: 120, maxBytes: 10_000_000 };

describe('Audio-Moderationsgrenzen', () => {
  it('akzeptiert kurze Audiodateien innerhalb des Größenlimits', () => {
    expect(audioWithinModerationLimits({ durationSeconds: 30, fileSize: 500_000 }, limits)).toBe(
      true,
    );
  });

  it('überspringt zu lange oder zu große Audiodateien', () => {
    expect(audioWithinModerationLimits({ durationSeconds: 121, fileSize: 500_000 }, limits)).toBe(
      false,
    );
    expect(audioWithinModerationLimits({ durationSeconds: 30, fileSize: 10_000_001 }, limits)).toBe(
      false,
    );
  });

  it('akzeptiert fehlende Telegram-Größenangaben für die spätere Downloadprüfung', () => {
    expect(audioWithinModerationLimits({ durationSeconds: 60 }, limits)).toBe(true);
  });
});

describe('begrenzter Audiodownload', () => {
  it('liest eine chunked Antwort innerhalb des Limits', async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.from([1, 2]));
          controller.enqueue(Uint8Array.from([3, 4]));
          controller.close();
        },
      }),
    );

    await expect(readAudioResponseBuffer(response, 4)).resolves.toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it('bricht eine chunked Antwort bytegenau oberhalb des Limits ab', async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(5));
          controller.close();
        },
      }),
    );

    await expect(readAudioResponseBuffer(response, 4)).rejects.toThrow('Größenlimit');
  });

  it('lehnt bereits eine zu große Content-Length ab', async () => {
    const response = new Response(new Uint8Array(1), {
      headers: { 'content-length': '5' },
    });

    await expect(readAudioResponseBuffer(response, 4)).rejects.toThrow('Größenlimit');
  });
});

describe('WAV-Pipe-Header', () => {
  it('setzt unbekannte RIFF- und Datenlängen auf die echten Puffergrößen', () => {
    const wav = Buffer.alloc(48);
    wav.write('RIFF', 0, 'ascii');
    wav.writeUInt32LE(0xffff_ffff, 4);
    wav.write('WAVE', 8, 'ascii');
    wav.write('fmt ', 12, 'ascii');
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16_000, 24);
    wav.writeUInt32LE(32_000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36, 'ascii');
    wav.writeUInt32LE(0xffff_ffff, 40);

    const result = finalizePipeWavHeader(wav);

    expect(result.readUInt32LE(4)).toBe(40);
    expect(result.readUInt32LE(40)).toBe(4);
  });

  it('verwirft Ausgaben ohne WAV-Datenblock', () => {
    const invalid = Buffer.alloc(44);
    invalid.write('RIFF', 0, 'ascii');
    invalid.write('WAVE', 8, 'ascii');
    expect(() => finalizePipeWavHeader(invalid)).toThrow('WAV-Audiodaten');
  });
});
