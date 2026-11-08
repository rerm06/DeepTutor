/**
 * Gemini Live client over the raw WebSocket protocol (no SDK: ~6 KB instead of a 12 MB package).
 * Wire format per ai.google.dev Live API (BidiGenerateContent): first message { setup }, wait for setupComplete;
 * mic audio as realtimeInput.audio (16-bit PCM, 16 kHz, little-endian, base64, mime "audio/pcm;rate=16000");
 * model audio arrives as serverContent.modelTurn.parts[].inlineData (16-bit PCM, 24 kHz); tool calls as
 * toolCall.functionCalls[] answered with toolResponse.functionResponses[] matched by id.
 * The browser authenticates with a one-session ephemeral token minted by our API (the key stays server-side).
 */

export interface LiveToken {
  token: string;
  model: string;
  ws_url: string;
  expires_at: string;
}

export interface FunctionDecl {
  name: string;
  description: string;
  parameters?: {
    type: "OBJECT";
    properties: Record<string, { type: "STRING" | "BOOLEAN"; description: string }>;
    required?: string[];
  };
}

export interface LiveCallbacks {
  onStatus(
    s: "connecting" | "ready" | "listening" | "speaking" | "closed" | "error",
    detail?: string,
  ): void;
  onUserText(t: string, final: boolean): void;
  onAgentText(t: string, final: boolean): void;
  onLevel(level: number): void;
  onTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

const IN_RATE = 16_000;
const OUT_RATE = 24_000;

// Captures the mic, mixes to mono, decimates to 16 kHz and posts Int16 chunks of ~100 ms.
const WORKLET = `
class Pcm16 extends AudioWorkletProcessor {
  constructor(o) { super(); this.ratio = sampleRate / ${IN_RATE}; this.acc = 0; this.n = 0; this.buf = new Int16Array(${IN_RATE / 10}); this.i = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let peak = 0;
    for (let k = 0; k < ch.length; k++) {
      const s = ch[k]; this.acc += s; this.n += 1; if (Math.abs(s) > peak) peak = Math.abs(s);
      if (this.n >= this.ratio) {
        const v = Math.max(-1, Math.min(1, this.acc / this.n));
        this.buf[this.i++] = v < 0 ? v * 0x8000 : v * 0x7fff; this.acc = 0; this.n -= this.ratio;
        if (this.i === this.buf.length) { this.port.postMessage({ pcm: this.buf.buffer, peak }, [this.buf.buffer]); this.buf = new Int16Array(${IN_RATE / 10}); this.i = 0; peak = 0; }
      }
    }
    return true;
  }
}
registerProcessor('pcm16', Pcm16);`;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(b64: string): ArrayBuffer {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}

export class LiveSession {
  private ws: WebSocket | null = null;
  private micCtx: AudioContext | null = null;
  private outCtx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private playing = new Set<AudioBufferSourceNode>();
  private nextAt = 0;
  private ready = false;
  private micOn = false;
  private userBuf = "";
  private agentBuf = "";

  constructor(
    private readonly cb: LiveCallbacks,
    private readonly setup: {
      systemInstruction: string;
      tools: FunctionDecl[];
      voice?: string;
    },
  ) {}

  async connect(tok: LiveToken): Promise<void> {
    this.cb.onStatus("connecting");
    this.outCtx = new AudioContext({ sampleRate: OUT_RATE });
    const url = `${tok.ws_url}?access_token=${encodeURIComponent(tok.token)}`;
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      const timer = window.setTimeout(() => reject(new Error("live_timeout")), 12_000);
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            setup: {
              model: `models/${tok.model}`,
              generationConfig: {
                responseModalities: ["AUDIO"],
                ...(this.setup.voice
                  ? {
                      speechConfig: {
                        voiceConfig: { prebuiltVoiceConfig: { voiceName: this.setup.voice } },
                      },
                    }
                  : {}),
              },
              systemInstruction: { parts: [{ text: this.setup.systemInstruction }] },
              tools: [{ functionDeclarations: this.setup.tools }],
              inputAudioTranscription: {},
              outputAudioTranscription: {},
            },
          }),
        );
      };
      ws.onmessage = async (ev) => {
        const raw = typeof ev.data === "string" ? ev.data : await (ev.data as Blob).text();
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(raw);
        } catch {
          return;
        }
        if ("setupComplete" in msg && !this.ready) {
          this.ready = true;
          window.clearTimeout(timer);
          this.cb.onStatus("ready");
          resolve();
          return;
        }
        this.handle(msg);
      };
      ws.onerror = () => {
        window.clearTimeout(timer);
        if (!this.ready) reject(new Error("live_socket"));
        else this.cb.onStatus("error", "socket");
      };
      ws.onclose = (ev) => {
        window.clearTimeout(timer);
        if (!this.ready) reject(new Error(`live_closed_${ev.code}`));
        this.ready = false;
        this.stopMic();
        this.cb.onStatus("closed", ev.reason || String(ev.code));
      };
    });
  }

  private send(obj: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  private async handle(msg: Record<string, unknown>) {
    const sc = msg.serverContent as
      | {
          modelTurn?: {
            parts?: { inlineData?: { data: string; mimeType?: string }; text?: string }[];
          };
          turnComplete?: boolean;
          interrupted?: boolean;
          inputTranscription?: { text?: string };
          outputTranscription?: { text?: string };
        }
      | undefined;
    if (sc) {
      if (sc.interrupted) this.flushAudio();
      if (sc.inputTranscription?.text) {
        this.userBuf += sc.inputTranscription.text;
        this.cb.onUserText(this.userBuf, false);
      }
      if (sc.outputTranscription?.text) {
        if (this.userBuf) {
          this.cb.onUserText(this.userBuf, true);
          this.userBuf = "";
        }
        this.agentBuf += sc.outputTranscription.text;
        this.cb.onAgentText(this.agentBuf, false);
      }
      for (const p of sc.modelTurn?.parts ?? []) {
        if (p.inlineData?.data) this.play(fromBase64(p.inlineData.data));
      }
      if (sc.turnComplete) {
        if (this.userBuf) this.cb.onUserText(this.userBuf, true);
        if (this.agentBuf) this.cb.onAgentText(this.agentBuf, true);
        this.userBuf = "";
        this.agentBuf = "";
      }
    }
    const tc = msg.toolCall as
      | { functionCalls?: { id: string; name: string; args?: Record<string, unknown> }[] }
      | undefined;
    if (tc?.functionCalls?.length) {
      const functionResponses = [];
      for (const fc of tc.functionCalls) {
        let result: unknown;
        try {
          result = await this.cb.onTool(fc.name, fc.args ?? {});
        } catch (e) {
          result = { ok: false, error: (e as Error).message };
        }
        functionResponses.push({ id: fc.id, name: fc.name, response: { result } });
      }
      this.send({ toolResponse: { functionResponses } });
    }
    if ("goAway" in msg) this.cb.onStatus("error", "session_ending");
  }

  private play(buf: ArrayBuffer) {
    const ctx = this.outCtx;
    if (!ctx) return;
    const pcm = new Int16Array(buf);
    const audio = ctx.createBuffer(1, pcm.length, OUT_RATE);
    const ch = audio.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = (pcm[i] as number) / 0x8000;
    const src = ctx.createBufferSource();
    src.buffer = audio;
    src.connect(ctx.destination);
    const at = Math.max(ctx.currentTime + 0.02, this.nextAt);
    src.start(at);
    this.nextAt = at + audio.duration;
    this.playing.add(src);
    this.cb.onStatus("speaking");
    src.onended = () => {
      this.playing.delete(src);
      if (this.playing.size === 0) this.cb.onStatus(this.micOn ? "listening" : "ready");
    };
  }

  /** Stop the model's voice at once (the person started talking, or pressed stop). */
  flushAudio() {
    for (const s of this.playing) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.playing.clear();
    this.nextAt = 0;
  }

  async startMic(): Promise<void> {
    if (this.micOn) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.micCtx = new AudioContext();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    try {
      await this.micCtx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const src = this.micCtx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.micCtx, "pcm16");
    this.node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; peak: number }>) => {
      this.cb.onLevel(e.data.peak);
      this.send({
        realtimeInput: {
          audio: { data: toBase64(e.data.pcm), mimeType: `audio/pcm;rate=${IN_RATE}` },
        },
      });
    };
    src.connect(this.node);
    this.micOn = true;
    this.cb.onStatus("listening");
  }

  stopMic() {
    if (!this.micOn && !this.stream) return;
    this.micOn = false;
    this.node?.disconnect();
    this.node = null;
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    void this.micCtx?.close();
    this.micCtx = null;
    this.send({ realtimeInput: { audioStreamEnd: true } });
    this.cb.onLevel(0);
  }

  get micActive() {
    return this.micOn;
  }

  /** A typed message (or the "ask everything" instruction) as a complete user turn. */
  sendText(text: string) {
    this.send({
      clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: true },
    });
  }

  close() {
    this.stopMic();
    this.flushAudio();
    void this.outCtx?.close();
    this.outCtx = null;
    try {
      this.ws?.close(1000, "bye");
    } catch {
      /* closed */
    }
    this.ws = null;
  }
}
