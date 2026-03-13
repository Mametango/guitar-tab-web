import cors from "cors";
import express from "express";
import multer from "multer";
import { analyzeRecording } from "./services/analyzeRecording.js";

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

app.listen(port, () => {
  console.log(`API server listening on http://localhost:${port}`);
});
