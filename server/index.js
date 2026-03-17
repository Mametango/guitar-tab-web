import cors from "cors";
import express from "express";
import multer from "multer";
import { analyzeRecording } from "./services/analyzeRecording.js";
import { defaultAuthor, getScore, listScores, saveScore } from "./services/scoreStore.js";

const app = express();
const port = process.env.PORT || 3001;
const allowedOrigin = process.env.CORS_ORIGIN || "";
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

app.use(cors({
  origin: allowedOrigin || true,
}));
app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.get("/api/scores", async (_request, response) => {
  try {
    const scores = await listScores();
    response.json({
      authorName: defaultAuthor,
      scores,
    });
  } catch (error) {
    response.status(500).json({
      error: "failed to load scores",
      detail: error instanceof Error ? error.message : "unknown error",
    });
  }
});

app.get("/api/scores/:id", async (request, response) => {
  try {
    const score = await getScore(request.params.id);

    if (!score) {
      response.status(404).json({
        error: "score not found",
      });
      return;
    }

    response.json(score);
  } catch (error) {
    response.status(500).json({
      error: "failed to load score",
      detail: error instanceof Error ? error.message : "unknown error",
    });
  }
});

app.post("/api/scores", async (request, response) => {
  try {
    const saved = await saveScore(request.body ?? {});
    response.status(201).json(saved);
  } catch (error) {
    response.status(500).json({
      error: "failed to save score",
      detail: error instanceof Error ? error.message : "unknown error",
    });
  }
});

app.post("/api/analyze", upload.single("audio"), async (request, response) => {
  try {
    if (!request.file) {
      response.status(400).json({
        error: "audio file is required",
      });
      return;
    }

    const result = await analyzeRecording({
      fileName: request.file.originalname,
      mimeType: request.file.mimetype,
      size: request.file.size,
      buffer: request.file.buffer,
    });

    response.json(result);
  } catch (error) {
    response.status(500).json({
      error: "failed to analyze recording",
      detail: error instanceof Error ? error.message : "unknown error",
    });
  }
});

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`API server listening on http://localhost:${port}`);
  });
}

export default app;
