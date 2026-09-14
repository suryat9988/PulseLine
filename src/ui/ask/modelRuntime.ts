import { applyModelExplanation, type PulseAnswer } from "../../../lib/ask/index.ts";

export const ASK_MODEL_ID = "Llama-3.2-1B-Instruct-q4f16_1-MLC";
export const ASK_MODEL_LABEL = "Llama 3.2 1B Instruct (q4, MLC)";
export const ASK_MODEL_HOST = "Hugging Face (mlc-ai)";
export const ASK_MODEL_LICENSE = "Llama 3.2 Community License; WebLLM is Apache-2.0";
export const ASK_MODEL_SIZE_NOTE =
  "About 700 MB on first download. Files stay on this device and are not part of the PulseLine site bundle.";

export type ModelStatus = "idle" | "prompt" | "downloading" | "ready" | "failed" | "unavailable";

type ProgressFn = (percent: number, text: string) => void;

interface EngineLike {
  chat: {
    completions: {
      create: (request: {
        messages: { role: "system" | "user"; content: string }[];
        temperature: number;
        max_tokens: number;
      }) => Promise<{ choices: { message: { content?: string | null } }[] }>;
    };
  };
  unload?: () => Promise<void>;
}

export class AskModelLoadCancelled extends Error {
  override name = "AskModelLoadCancelled";
  constructor() {
    super("The on-device helper download was cancelled.");
  }
}

let engine: EngineLike | null = null;
let activeWorker: Worker | null = null;
let loadToken = 0;

export function askModelIsReady(): boolean {
  return engine !== null;
}

export function isAskModelLoadCancelled(error: unknown): boolean {
  return error instanceof AskModelLoadCancelled;
}

export function cancelAskModel(): void {
  loadToken += 1;
  activeWorker?.terminate();
  activeWorker = null;
  engine = null;
}

export function resetAskModel(): void {
  cancelAskModel();
}

export async function webgpuAvailable(): Promise<boolean> {
  const gpu = navigator.gpu;
  if (!gpu) return false;
  try {
    return Boolean(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

export async function loadAskModel(onProgress: ProgressFn): Promise<void> {
  if (engine) return;
  if (!(await webgpuAvailable())) {
    throw new Error("WebGPU is not available on this device, so the on-device helper cannot load.");
  }
  const token = loadToken;
  const webllm = await import("@mlc-ai/web-llm");
  if (token !== loadToken) throw new AskModelLoadCancelled();
  const worker = new Worker(new URL("./webllm-worker.ts", import.meta.url), { type: "module" });
  activeWorker = worker;
  try {
    engine = await webllm.CreateWebWorkerMLCEngine(worker, ASK_MODEL_ID, {
      initProgressCallback: (report: { progress: number; text: string }) => {
        if (token !== loadToken) return;
        onProgress(Math.round((report.progress || 0) * 100), report.text);
      },
    });
    if (token !== loadToken) {
      engine = null;
      worker.terminate();
      throw new AskModelLoadCancelled();
    }
  } catch (error) {
    if (token !== loadToken) throw new AskModelLoadCancelled();
    activeWorker = null;
    throw error;
  }
}

export async function explainWithModel(answer: PulseAnswer): Promise<PulseAnswer> {
  if (!engine) return applyModelExplanation(answer, null, { modelRan: false });
  try {
    const result = await engine.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            'Reply with only this JSON object and no other text: {"choice":"restate"}. Any other output is discarded.',
        },
        {
          role: "user",
          content: `Approved PulseLine answer (do not rewrite):\n${answer.statement}`,
        },
      ],
      temperature: 0,
      max_tokens: 24,
    });
    return applyModelExplanation(answer, result.choices[0]?.message.content ?? null, { modelRan: true });
  } catch {
    return applyModelExplanation(answer, null, { modelRan: true });
  }
}
