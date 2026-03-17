import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = process.env.DATA_DIR?.trim()
  ? path.resolve(process.env.DATA_DIR.trim())
  : path.resolve(__dirname, "../data");
const dataFile = path.join(dataDir, "scores.json");
const defaultAuthor = "名無しの弾き語りさん";
const githubToken = process.env.GITHUB_TOKEN?.trim() || "";
const githubRepoOwner = process.env.GITHUB_REPO_OWNER?.trim() || "";
const githubRepoName = process.env.GITHUB_REPO_NAME?.trim() || "";
const githubRepoBranch = process.env.GITHUB_REPO_BRANCH?.trim() || "main";
const githubStoragePath = process.env.GITHUB_STORAGE_PATH?.trim() || "server/data/scores.json";

function hasGithubStore() {
  return githubToken && githubRepoOwner && githubRepoName;
}

async function githubRequest(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub storage request failed with ${response.status}`);
  }

  return response.json();
}

async function readGithubScores() {
  const url =
    `https://api.github.com/repos/${githubRepoOwner}/${githubRepoName}/contents/${githubStoragePath}?ref=${githubRepoBranch}`;

  const payload = await githubRequest(url);
  const raw = Buffer.from(payload.content ?? "", "base64").toString("utf8");
  const parsed = JSON.parse(raw);

  return {
    scores: Array.isArray(parsed) ? parsed : [],
    sha: payload.sha,
  };
}

async function writeGithubScores(scores, sha) {
  const url = `https://api.github.com/repos/${githubRepoOwner}/${githubRepoName}/contents/${githubStoragePath}`;
  const content = Buffer.from(JSON.stringify(scores, null, 2), "utf8").toString("base64");

  await githubRequest(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: `Update public scores ${new Date().toISOString()}`,
      content,
      branch: githubRepoBranch,
      sha: sha || undefined,
    }),
  });
}

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
  if (hasGithubStore()) {
    const { scores } = await readGithubScores();
    return scores;
  }

  await ensureDataFile();
  const raw = await readFile(dataFile, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

async function writeScores(scores) {
  if (hasGithubStore()) {
    const { sha } = await readGithubScores();
    await writeGithubScores(scores, sha);
    return;
  }

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
