import express, { Request, Response } from "express";
import cors from "cors";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { AIMessage } from "@langchain/core/messages";
import {
  buildCfsGraph,
  createInitialState,
  runTurn,
  type CfsState,
} from "./langgraph/graph.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());
app.use(express.static(path.resolve(__dirname, "../public")));

const graphApp = buildCfsGraph();
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
  res.sendFile(path.resolve(__dirname, "../index.html"));
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
    const sessionKey = sessionId || "default-thread";
    const existingState = sessionStore.get(sessionKey) ?? createInitialState({ sessionId: sessionKey });
    const prevLen = existingState.messages.length;

    // Treat initial "start" as a kick-off without adding a user message.
    const userInput = message === "start" && prevLen === 0 ? undefined : message;
    const nextState = await runTurn(graphApp, existingState, userInput);
    sessionStore.set(sessionKey, nextState);

    const newMessages = nextState.messages.slice(prevLen).filter((m) => m instanceof AIMessage);
    const content =
      newMessages
        .map((m) => toText(m.content))
        .filter(Boolean)
        .join("\n\n") || "Sorry, I could not process the response.";

    return res.json({ response: content });
  } catch (error: any) {
    console.error("Chat error:", error);
    return res.status(500).json({
      response: "Error processing request",
      error: error?.message,
    });
  }
});

app.get("/test", (_req: Request, res: Response) => {
  res.json({ status: "Server is running" });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log("=== Server Started ===");
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Test server status at http://localhost:${PORT}/test`);
});
