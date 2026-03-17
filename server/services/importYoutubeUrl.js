import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { analyzeRecording } from "./analyzeRecording.js";
import { createYoutubeDraft } from "./createYoutubeDraft.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceToolsDir = path.resolve(__dirname, "../../tools");
const externalBackendUrl = process.env.YOUTUBE_IMPORT_BACKEND_URL?.trim() || "";
const externalBackendToken = process.env.YOUTUBE_IMPORT_BACKEND_TOKEN?.trim() || "";

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(stderr || `${command} exited with code ${code}`));
    });
  });
}

async function fileExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveCommand(command) {
  const localCandidates = {
    "yt-dlp": [
      path.join(workspaceToolsDir, "yt-dlp", "yt-dlp.exe"),
      path.join(workspaceToolsDir, "yt-dlp.exe"),
    ],
    ffmpeg: [
      path.join(workspaceToolsDir, "ffmpeg", "bin", "ffmpeg.exe"),
      path.join(workspaceToolsDir, "ffmpeg", "ffmpeg-8.1-essentials_build", "bin", "ffmpeg.exe"),
      path.join(workspaceToolsDir, "ffmpeg.exe"),
    ],
    deno: [
      path.join(workspaceToolsDir, "deno", "deno.exe"),
      path.join(workspaceToolsDir, "deno.exe"),
    ],
  };

  for (const candidate of localCandidates[command] ?? []) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  const checker = process.platform === "win32" ? "where" : "which";

  try {
    const result = await runCommand(checker, [command], { windowsHide: true });
    const match = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);

    return match || null;
  } catch {
    return null;
  }
}

async function getToolStatus() {
  const [ytDlpPath, ffmpegPath, denoPath] = await Promise.all([
    resolveCommand("yt-dlp"),
    resolveCommand("ffmpeg"),
    resolveCommand("deno"),
  ]);

  return {
    ytDlpPath,
    ffmpegPath,
    denoPath,
    canExtract: Boolean(ytDlpPath && ffmpegPath && denoPath),
  };
}

function sanitizeTitle(rawTitle) {
  return rawTitle.replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").trim() || "youtube-audio";
}

async function tryExternalBackend(url) {
  if (!externalBackendUrl) {
    return null;
  }

  const response = await fetch(externalBackendUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(externalBackendToken ? { Authorization: `Bearer ${externalBackendToken}` } : {}),
    },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    throw new Error(`External YouTube backend failed with ${response.status}`);
  }

  const payload = await response.json();
  return {
    ...payload,
    importMode: payload.importMode || "delegated",
    extractionAvailable: true,
    notes:
      `${payload.notes || ""} Imported through an external YouTube extraction backend.`.trim(),
  };
}

async function tryLocalExtraction(url) {
  const toolStatus = await getToolStatus();

  if (!toolStatus.canExtract) {
    return null;
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "guitar-youtube-"));
  const wavPath = path.join(tempDir, "audio.wav");

  try {
    const ytDlpEnv = {
      ...process.env,
      PATH: `${path.dirname(toolStatus.ytDlpPath)};${path.dirname(toolStatus.ffmpegPath)};${path.dirname(toolStatus.denoPath)};${process.env.PATH || ""}`,
      TEMP: tempDir,
      TMP: tempDir,
    };

    const info = await runCommand(toolStatus.ytDlpPath, [
      "--print",
      "%(title)s",
      "--no-playlist",
      "--js-runtimes",
      `deno:${toolStatus.denoPath}`,
      url,
    ], { windowsHide: true, env: ytDlpEnv });

    const rawTitle = info.stdout.trim().split(/\r?\n/).filter(Boolean).pop() || "youtube-audio";

    await runCommand(toolStatus.ytDlpPath, [
      "--no-playlist",
      "--js-runtimes",
      `deno:${toolStatus.denoPath}`,
      "-f",
      "bestaudio",
      "-x",
      "--audio-format",
      "wav",
      "--ffmpeg-location",
      toolStatus.ffmpegPath,
      "--postprocessor-args",
      `ffmpeg:-ac 1 -ar 44100 -sample_fmt s16`,
      "-o",
      wavPath,
      url,
    ], { windowsHide: true, env: ytDlpEnv });

    const buffer = await readFile(wavPath);
    const result = await analyzeRecording({
      fileName: `${sanitizeTitle(rawTitle)}.wav`,
      mimeType: "audio/wav",
      size: buffer.length,
      buffer,
    });

    return {
      ...result,
      title: rawTitle,
      sourceUrl: url,
      importMode: "extracted",
      extractionAvailable: true,
      notes:
        `${result.notes} Imported from YouTube audio using local extraction tools.`,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function buildFallbackDraft(url) {
  const draft = createYoutubeDraft(url);
  const reasons = [];

  if (!externalBackendUrl) {
    reasons.push("no external YouTube backend is configured");
  }

  reasons.push("yt-dlp, ffmpeg, and deno are not all available in the current runtime");

  return {
    ...draft,
    importMode: "draft",
    extractionAvailable: false,
    notes:
      `${draft.notes} Falling back to a manual draft because ${reasons.join(" and ")}.`,
  };
}

export async function importYoutubeUrl(url) {
  if (externalBackendUrl) {
    try {
      return await tryExternalBackend(url);
    } catch {
      // Fall through to local extraction or draft fallback.
    }
  }

  const localExtraction = await tryLocalExtraction(url);
  if (localExtraction) {
    return localExtraction;
  }

  return buildFallbackDraft(url);
}
