import express, { Request, Response } from "express";
import cors from "cors";
import path from "path";
import dotenv from "dotenv";
import { AIMessage } from "@langchain/core/messages";
import {
  buildGraphFromSchema,
  createInitialState,
  runTurn,
  type CfsState,
} from "./langgraph/graph.js";
import { computeFlowProgress } from "./langgraph/infra.js";
import { getOptionsForQuestionKey } from "./langgraph/core/options/resolve-options.js";
import { resolveAppConfig, getTemplatePath } from "./config/appConfig.js";

dotenv.config();

const appConfig = resolveAppConfig();
const graphApp = buildGraphFromSchema(appConfig.flowPath);
const templatePath = getTemplatePath(appConfig.template);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(templatePath));

const sessionStore = new Map<string, CfsState>();

const toText = (content: unknown) => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : typeof part === "object" && part !== null && "text" in part ? (part as { text?: string }).text ?? "" : ""))
      .join("\n");
  }
  if (content && typeof content === "object" && "toString" in content) return (content as any).toString();
  return content ? String(content) : "";
};

app.get("/", (_req: Request, res: Response) => {
  res.sendFile(path.join(templatePath, "index.html"));
});

interface ChatRequestBody {
  message?: string;
  sessionId?: string;
}

app.post("/chat", async (req: Request<unknown, unknown, ChatRequestBody>, res: Response) => {
  const { message, sessionId } = req.body || {};
  if (!message) {
    return res.status(400).json({ response: "Please provide a message." });
  }
  try {
    // #region agent log
    if (message === "Continue to readout") {
      fetch("http://127.0.0.1:7246/ingest/70f1d823-04ab-4354-9a86-674e8c225569", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "e7c980" },
        body: JSON.stringify({
          sessionId: "e7c980",
          location: "server.ts:continue-flow",
          message: "Continue to readout message received",
          data: { hypothesisId: "E" },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    }
    // #endregion
    const sessionKey = sessionId || "default-thread";
    const existingState = sessionStore.get(sessionKey) ?? createInitialState({ sessionId: sessionKey });
    const prevLen = existingState.messages.length;

    const userInput = message === "start" && prevLen === 0 ? undefined : message;
    const nextState = await runTurn(graphApp, existingState, userInput);
    sessionStore.set(sessionKey, nextState);

    const newMessages = nextState.messages.slice(prevLen).filter((m) => m instanceof AIMessage);
    const content =
      newMessages
        .map((m) => toText(m.content))
        .filter(Boolean)
        .join("\n\n") || "Sorry, I could not process the response.";

    const flowProgress = computeFlowProgress(nextState);
    // #region agent log
    fetch("http://127.0.0.1:7246/ingest/70f1d823-04ab-4354-9a86-674e8c225569", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "e7c980" },
      body: JSON.stringify({
        sessionId: "e7c980",
        location: "server.ts:pre-options",
        message: "Before getOptionsForQuestionKey",
        data: { hypothesisId: "C" },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    const options = await getOptionsForQuestionKey(nextState.session_context.last_question_key, nextState);

    return res.json({ response: content, flowProgress, options });
  } catch (error: any) {
    console.error("Chat error:", error);
    // #region agent log
    fetch("http://127.0.0.1:7246/ingest/70f1d823-04ab-4354-9a86-674e8c225569", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "e7c980" },
      body: JSON.stringify({
        sessionId: "e7c980",
        location: "server.ts:catch",
        message: "Chat error caught",
        data: {
          errorMessage: error?.message,
          errorName: error?.name,
          errorStack: error?.stack?.slice(0, 500),
          message,
          hypothesisId: "A",
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    return res.status(500).json({
      response: "Error processing request",
      error: error?.message,
    });
  }
});

app.get("/test", (_req: Request, res: Response) => {
  res.json({ status: "Server is running" });
});

app.get("/readout/:sessionId.md", (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const state = sessionStore.get(sessionId);
  if (!state?.readout_context?.rendered_outputs?.markdown) {
    return res.status(404).send("Readout not found.");
  }
  res.setHeader("Content-Type", "text/markdown");
  res.setHeader("Content-Disposition", `attachment; filename="readout-${sessionId}.md"`);
  res.send(state.readout_context.rendered_outputs.markdown);
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log("=== Server Started ===");
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Test server status at http://localhost:${PORT}/test`);
});
