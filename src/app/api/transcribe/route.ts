import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── POST /api/transcribe — speech-to-text for the composer mic button ──────
// Body: { audio: base64 string } (wav/mp3/webm/m4a from MediaRecorder)
// Resp: { text } | { error }

const MAX_BASE64_LENGTH = 24 * 1024 * 1024; // ~24 MB encoded (≈18 MB audio)

export async function POST(req: NextRequest) {
  let audio = "";
  try {
    const body = (await req.json()) as { audio?: unknown };
    audio = typeof body.audio === "string" ? body.audio : "";
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!audio) {
    return NextResponse.json({ error: "Missing audio data" }, { status: 400 });
  }
  if (audio.length > MAX_BASE64_LENGTH) {
    return NextResponse.json(
      { error: "Recording too large — keep clips under ~60 seconds." },
      { status: 413 }
    );
  }

  try {
    const zai = await ZAI.create();
    const res = await zai.audio.asr.create({ file_base64: audio });
    const text = (res?.text ?? "").trim();
    return NextResponse.json({ text });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transcription failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
