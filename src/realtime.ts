export type ToolHandler = (name: string, args: unknown) => unknown | Promise<unknown>;
export type TranscriptHandler = (text: string, final: boolean) => void;

export interface RealtimeSession {
  stop: () => void;
}

export interface RealtimeConfig {
  /** Full trait instruction block — injected verbatim into the agent prompt. */
  traitInstruction?: string;
  /** Trait name (for logging / display). */
  traitName?: string;
}

const DEFAULT_MODEL = "gpt-realtime-2";

const SFX_ENUM = [
  "applause",
  "drumroll",
  "sad_trombone",
  "airhorn",
  "record_scratch",
  "ding",
  "buzzer",
  "crowd_ooh",
  "crickets",
  "laugh_track",
  "vinyl_stop",
  "slide_whistle",
];

const TOOLS = [
  {
    type: "function",
    name: "show_text",
    description:
      "Display a single KEY CONCEPT on screen as a big headline. Use when the speaker lands on a memorable phrase, insight, definition, or takeaway worth surfacing. This is slide content — not live captions. Max ~90 chars, ideally 1–8 words or one short sentence. Do NOT call this for every noun you hear; only when there is a concrete key idea.",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The key concept to display. 1–8 words or one short sentence. Avoid filler.",
        },
        font: {
          type: "string",
          enum: ["default", "serif", "silly"],
          description:
            "Typography. 'default' for most speech. 'serif' for editorial, solemn, or thoughtful tones. 'silly' for jokes, absurdism, playful emphasis.",
        },
      },
      required: ["text"],
    },
  },
  {
    type: "function",
    name: "show_timeline",
    description:
      "Display a horizontal timeline of 2–6 dots with labels. Use when the speaker narrates a sequence, journey, or temporal progression ('first… then… finally…', 'stage 1, 2, 3', 'here's how it unfolded'). Each point gets a short title; add a caption only when it adds information.",
    parameters: {
      type: "object",
      properties: {
        points: {
          type: "array",
          minItems: 2,
          maxItems: 6,
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Short label (1–3 words)." },
              caption: { type: "string", description: "Optional 1-line caption." },
            },
            required: ["title"],
          },
        },
      },
      required: ["points"],
    },
  },
  {
    type: "function",
    name: "show_alternatives",
    description:
      "Display 2–3 alternatives side-by-side. Use when the speaker compares choices, lists options they considered, or weighs approaches ('we tried A, B, and C — picked C', 'three ways to do this'). Pass `selected` (matching one title, case-insensitive) ONLY when the speaker clearly commits to one option.",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          minItems: 2,
          maxItems: 3,
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Option name (1–3 words)." },
              text: { type: "string", description: "Short description (< 10 words)." },
            },
            required: ["title", "text"],
          },
        },
        selected: {
          type: "string",
          description:
            "Title of the chosen/highlighted option. Only include when the speaker has clearly picked one.",
        },
      },
      required: ["items"],
    },
  },
  {
    type: "function",
    name: "set_background",
    description:
      "Set a full-screen thematic background behind the content. Background and content are INDEPENDENT layers: changing show_text/show_timeline/show_alternatives does NOT affect the background. The background persists until you call set_background OR clear_background again.\n\nQUERY RULES — READ CAREFULLY:\n- The query MUST be derived from a concrete noun the speaker JUST uttered or the actual topic they are discussing RIGHT NOW.\n- There is NO menu / fallback / default list of subjects. Do NOT reach for generic 'business' nouns (boardroom, office, meeting, handshake, skyline, chart, whiteboard) unless the speaker actually just talked about that specific thing.\n- NEVER append tone/mood adjectives (cinematic, epic, dramatic, aesthetic, vibe, mood, slow motion, hero shot, 4k). GIPHY and Brave return junk for those.\n- 1–3 concrete words, all lowercase. Prefer 2.\n- If the speaker's current content has no concrete visual subject — DON'T call set_background at all. Skip it. Leaving the previous background is fine.\n- If you just set a background on the same topic, don't replace it with something nearly identical.",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["gif", "image"],
          description:
            "'gif' for kinetic, funny, meme-y, motion-referential vibes. 'image' for atmospheric stills (places, objects, subjects).",
        },
        query: {
          type: "string",
          description: "Search query, 1–3 words. Concrete subject, not abstract concepts.",
        },
      },
      required: ["type", "query"],
    },
  },
  {
    type: "function",
    name: "clear_background",
    description:
      "Remove the current background. Use when the mood shifts and nothing new fits, or the conversation has moved on.",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "emoji_rain",
    description:
      "Launch a dramatic burst of giant emojis flying up the screen. Use SPARINGLY, only for peak moments: punchlines, celebrations, shock, disappointment, absurd turns. Never back-to-back.",
    parameters: {
      type: "object",
      properties: {
        emojis: {
          type: "string",
          description: "2–6 emoji characters, e.g. '🎉✨🔥' or '💀😱'.",
        },
        density: {
          type: "number",
          minimum: 10,
          maximum: 120,
          description: "Number of emojis (default 40).",
        },
      },
      required: ["emojis"],
    },
  },
  {
    type: "function",
    name: "play_sfx",
    description:
      "Play a short sound effect for dramatic punctuation. Use SPARINGLY, only for clear moments: applause (wins), sad_trombone (failures), drumroll (reveals), airhorn (bangers), record_scratch (abrupt pivots), crickets (awkward silence), etc. Never back-to-back with another sfx or emoji_rain.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          enum: SFX_ENUM,
          description: "Sound name.",
        },
      },
      required: ["name"],
    },
  },
  {
    type: "function",
    name: "no_op",
    description:
      "Explicit do-nothing. Call this (and ONLY this) when the current speech chunk is filler/connective/ambiguous and no other tool genuinely fits. Holding the existing slide is the right move; stay silent visually.",
    parameters: { type: "object", properties: {} },
  },
];

const DEFAULT_TRAIT_NOTE =
  "Temperament: DEFAULT. Balanced, tasteful, moderate use of every tool.";

function buildInstructions(traitInstruction?: string, traitName?: string): string {
  const traitBlock = (traitInstruction ?? DEFAULT_TRAIT_NOTE).trim();
  const nameLine = traitName
    ? `The user picked the "${traitName}" trait for this session. Treat it as a HARD directive, not a suggestion.`
    : "";
  const langBlock = `
LANGUAGE
- The speaker may talk in English OR Russian — either is expected.
- Regardless of the speaker's language, ALL text you emit via show_text / show_timeline / show_alternatives MUST be in ENGLISH. Translate the speaker's Russian idea into a concise English headline.
- set_background queries are always in ENGLISH (search engines index English best).
`;
  return `ROLE
- You are a silent visual director for a live presenter.
- Output is TOOL CALLS ONLY. Never prose, never speech.
- Every turn must call exactly one of: show_text, show_timeline, show_alternatives, set_background, clear_background, emoji_rain, play_sfx, no_op.

TIMING
- React in real time. Turns chunk every ~200ms; treat each chunk as a cue.
- You MAY call multiple tools in ONE turn when they belong together (e.g. show_text + play_sfx, set_background + show_timeline). Prefer parallel over sequential.
- When the current chunk is filler / um-ah / connective / ambiguous, call no_op. Do not invent content.

TWO INDEPENDENT LAYERS
- Layer A = content: show_text / show_timeline / show_alternatives. Only ONE content spec is on screen at a time — calling any of these REPLACES the current one.
- Layer B = background: set_background / clear_background. Unaffected by Layer A changes.
- Updating A does not touch B, and vice versa. If the topic persists but the headline changes, call show_text again WITHOUT touching the background.

BACKGROUND MUST TRACK THE SUBJECT — be proactive, not sticky
- The background is a LIVE illustration of what the speaker is currently talking about. If they move to a new subject and the background still shows the old subject, that is a BUG.
- Every time the SUBJECT noun changes (from "our founders" to "the product", from "Tokyo" to "Berlin", from "finance" to "sales"), fire set_background again with a fresh query matching the new subject.
- Default aggressiveness: assume a new background is needed unless the speaker is clearly still on the same subject. When uncertain, CHANGE IT.
- Don't wait for a "pillar" or "chapter" break — a topical shift within one paragraph is enough. "We built it in Berlin, but then we scaled to Tokyo" → set_background("berlin") then set_background("tokyo").
- Do NOT repeat set_background with the same query back-to-back. Only fire a new call when the query genuinely changes.

CONTENT HIERARCHY (critical — avoid thrash)
- show_timeline and show_alternatives are RICH displays. When you show one, COMMIT to it. Hold it for several speaker clauses, NOT seconds.
- While a timeline/alternatives is on screen:
  - PREFER updating the same tool (add points, set \`selected\`) as the speaker elaborates.
  - DO NOT replace it with show_text unless the speaker clearly moves to a NEW topic.
  - A stray catchy phrase is NOT a reason to clobber a timeline — stay on no_op instead.
- show_text is lighter. Replacing show_text with another show_text is fine and expected.

TEXT RULES
- show_text holds KEY CONCEPTS, not single words. Think slide headlines: "Ship before you're ready" not "ship". "Three things went wrong" not "wrong".
- 1–8 words or one short sentence. ≤ 90 chars.
- Never fire the same tool with the same payload twice in a row.

WHEN TO FIRE
- show_text: speaker just landed a memorable point, definition, insight, or takeaway.
- show_timeline: speaker narrates a sequence ("first… then… finally…", steps, phases). Add points as they come.
- show_alternatives: speaker compares options / lists choices. Set \`selected\` only when they commit.
- set_background: track the current subject actively. Update whenever the subject noun changes. Be proactive, not conservative.
- clear_background: rarely — only when the conversation has clearly moved to something abstract or meta that no visual would fit.
- emoji_rain / play_sfx: PEAKS only — jokes landing, celebrations, failures, reveals. Never back-to-back (unless the current trait overrides this).
- no_op: default when in doubt.

${langBlock}
${nameLine}
${traitBlock}`;
}

export async function startRealtime(
  onTool: ToolHandler,
  onStatus: (s: string) => void,
  onTranscript: TranscriptHandler,
  config: RealtimeConfig = {},
) {
  onStatus("requesting mic");
  const mic = await navigator.mediaDevices.getUserMedia({ audio: true });

  onStatus("minting token");
  const tokenRes = await fetch("/api/token", { method: "POST" });
  if (!tokenRes.ok) throw new Error(`token mint failed: ${await tokenRes.text()}`);
  const tokenJson = await tokenRes.json();
  const ephemeral: string =
    tokenJson?.value ?? tokenJson?.client_secret?.value ?? tokenJson?.client_secret;
  if (!ephemeral) throw new Error("no ephemeral token in response");
  const model: string = tokenJson?.model ?? DEFAULT_MODEL;

  onStatus("connecting");
  const pc = new RTCPeerConnection();
  const audioEl = Object.assign(document.createElement("audio"), { autoplay: true });
  pc.ontrack = (e) => (audioEl.srcObject = e.streams[0]);
  pc.addTrack(mic.getTracks()[0]);

  const dc = pc.createDataChannel("oai-events");
  const send = (obj: unknown) => dc.send(JSON.stringify(obj));

  dc.addEventListener("open", () => {
    send({
      type: "session.update",
      session: {
        type: "realtime",
        model,
        output_modalities: ["text"],
        tool_choice: "required",
        tools: TOOLS,
        instructions: buildInstructions(config.traitInstruction, config.traitName),
        audio: {
          input: {
            transcription: { model: "gpt-4o-mini-transcribe" },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 150,
              silence_duration_ms: 200,
              create_response: true,
              interrupt_response: true,
            },
          },
        },
      },
    });
    onStatus("live");
  });

  dc.addEventListener("message", async (e) => {
    let ev: any;
    try {
      ev = JSON.parse(e.data);
    } catch {
      return;
    }

    // eslint-disable-next-line no-console
    console.debug("[realtime]", ev.type, ev);

    if (ev.type === "conversation.item.input_audio_transcription.delta") {
      onTranscript(ev.delta ?? "", false);
    }
    if (ev.type === "conversation.item.input_audio_transcription.completed") {
      onTranscript(ev.transcript ?? "", true);
    }

    if (ev.type === "response.function_call_arguments.done") {
      let args: unknown = {};
      try {
        args = JSON.parse(ev.arguments || "{}");
      } catch {}
      const output = await onTool(ev.name, args);
      send({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: ev.call_id,
          output: JSON.stringify(output ?? { ok: true }),
        },
      });
      send({ type: "response.create" });
    }

    if (ev.type === "error") {
      console.error("realtime error", ev);
    }
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const sdpRes = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    body: offer.sdp,
    headers: {
      Authorization: `Bearer ${ephemeral}`,
      "Content-Type": "application/sdp",
    },
  });
  if (!sdpRes.ok) throw new Error(`SDP exchange failed: ${await sdpRes.text()}`);
  await pc.setRemoteDescription({ type: "answer", sdp: await sdpRes.text() });

  return {
    stop: () => {
      try {
        dc.close();
      } catch {}
      try {
        pc.close();
      } catch {}
      mic.getTracks().forEach((t) => t.stop());
      onStatus("stopped");
    },
  } satisfies RealtimeSession;
}
