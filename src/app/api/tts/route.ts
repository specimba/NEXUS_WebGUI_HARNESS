import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── POST /api/tts — read assistant replies aloud ───────────────────────────
// Body: { text, voice?, speed? }  Resp: audio/wav (24 kHz, 16-bit, mono)
//
// The TTS API caps input at 1024 chars per request, so long replies are split
// at sentence boundaries. Each chunk is generated as raw PCM (24 kHz 16-bit
// mono), the PCM streams are concatenated and wrapped in a single 44-byte WAV
// header — the client receives one seamless playable file.

const MAX_INPUT_CHARS = 8000;
const CHUNK_CHARS = 900; // stay under the provider's 1024-char limit
const SAMPLE_RATE = 24000;
const DEFAULT_VOICE = "tongtong";

/** Split text into ≤CHUNK_CHARS pieces at sentence boundaries. */
function chunkText(text: string): string[] {
  if (text.length <= CHUNK_CHARS) return [text];
  const sentences = text.match(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g) ?? [text];
  const chunks: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && (cur + s).length > CHUNK_CHARS) {
      chunks.push(cur.trim());
      cur = s;
    } else {
      cur += s;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  // Hard-split any monster chunk that exceeds the cap on its own
  const out: string[] = [];
  for (const c of chunks) {
    for (let i = 0; i < c.length; i += CHUNK_CHARS) out.push(c.slice(i, i + CHUNK_CHARS));
  }
  return out;
}

/** Wrap raw little-endian 16-bit mono PCM in a canonical WAV container. */
function wavFromPcm(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // audio format: PCM
  header.writeUInt16LE(1, 22); // channels: mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate = rate × channels × 2
  header.writeUInt16LE(2, 32); // block align = channels × bytes-per-sample
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export async function POST(req: NextRequest) {
  let body: { text?: unknown; voice?: unknown; speed?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const voice = typeof body.voice === "string" && body.voice ? body.voice : DEFAULT_VOICE;
  let speed = typeof body.speed === "number" && Number.isFinite(body.speed) ? body.speed : 1;
  speed = Math.min(Math.max(speed, 0.5), 2); // API constraint: 0.5 – 2.0

  if (!text) {
    return NextResponse.json({ error: "Missing text" }, { status: 400 });
  }
  if (text.length > MAX_INPUT_CHARS) {
    return NextResponse.json(
      { error: `Text too long for one read-aloud request (${text.length} > ${MAX_INPUT_CHARS} chars)` },
      { status: 413 }
    );
  }

  try {
    const zai = await ZAI.create();
    const chunks = chunkText(text);
    const parts: Buffer[] = [];
    for (const chunk of chunks) {
      const res = await zai.audio.tts.create({
        input: chunk,
        voice,
        speed,
        response_format: "pcm",
        stream: false,
      });
      const arrayBuffer = await res.arrayBuffer();
      parts.push(Buffer.from(new Uint8Array(arrayBuffer)));
    }
    const wav = wavFromPcm(Buffer.concat(parts));
    return new NextResponse(new Uint8Array(wav), {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(wav.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Speech generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
