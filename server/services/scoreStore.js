import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, "../data");
const dataFile = path.join(dataDir, "scores.json");
const defaultAuthor = "名無しの弾き語りさん";

async function ensureDataFile() {
  await mkdir(dataDir, { recursive: true });

  try {
    await readFile(dataFile, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      await writeFile(dataFile, "[]", "utf8");
      return;
    }

    throw error;
  }
}

async function readScores() {
  await ensureDataFile();
  const raw = await readFile(dataFile, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

async function writeScores(scores) {
  await ensureDataFile();
  await writeFile(dataFile, JSON.stringify(scores, null, 2), "utf8");
}

function createId() {
  return crypto.randomBytes(4).toString("hex");
}

export async function listScores() {
  const scores = await readScores();

  return scores
    .slice()
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .map(({ id, title, authorName, updatedAt, measureCount, duration, engine }) => ({
      id,
      title,
      authorName,
      updatedAt,
      measureCount,
      duration,
      engine,
    }));
}

export async function getScore(id) {
  const scores = await readScores();
  return scores.find((score) => score.id === id) ?? null;
}

export async function saveScore(scoreInput) {
  const scores = await readScores();
  const now = new Date().toISOString();
  const id = scoreInput.id || createId();
  const existing = scores.find((score) => score.id === id);

  const measures = Array.isArray(scoreInput.measures) ? scoreInput.measures : [];
  const normalized = {
    id,
    title: String(scoreInput.title || "新しい譜面").trim() || "新しい譜面",
    authorName: defaultAuthor,
    fileName: String(scoreInput.fileName || "manual-input"),
    duration: String(scoreInput.duration || "00:00"),
    engine: String(scoreInput.engine || "manual-chord-entry"),
    notes: String(scoreInput.notes || ""),
    chords: Array.isArray(scoreInput.chords) ? scoreInput.chords : [],
    measures,
    measureCount: measures.length,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  const nextScores = existing
    ? scores.map((score) => (score.id === id ? normalized : score))
    : [normalized, ...scores];

  await writeScores(nextScores);
  return normalized;
}

export { defaultAuthor };
