import express from "express";
import cors from "cors";
import { importYoutubeUrl } from "./services/importYoutubeUrl.js";

const app = express();
const port = Number(process.env.PORT || 8080);
const backendToken = process.env.BACKEND_AUTH_TOKEN?.trim() || "";

app.use(express.json());
app.use(cors({ origin: true }));

app.get("/health", async (_request, response) => {
  response.json({
    ok: true,
    service: "youtube-import-backend",
  });
});

app.post("/import-youtube", async (request, response) => {
  try {
    if (backendToken) {
      const authHeader = request.header("authorization") || "";
      const expected = `Bearer ${backendToken}`;

      if (authHeader !== expected) {
        response.status(401).json({
          error: "unauthorized",
        });
        return;
      }
    }

    const youtubeUrl = String(request.body?.url || "").trim();

    if (!youtubeUrl) {
      response.status(400).json({
        error: "youtube url is required",
      });
      return;
    }

    const imported = await importYoutubeUrl(youtubeUrl);
    response.json(imported);
  } catch (error) {
    response.status(400).json({
      error: "failed to import youtube url",
      detail: error instanceof Error ? error.message : "unknown error",
    });
  }
});

app.listen(port, () => {
  console.log(`YouTube import backend listening on http://localhost:${port}`);
});
