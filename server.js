// Nova — a personal AI chatbot.
// A tiny web server: serves the chat page in public/ and streams replies from Claude.

import http from "node:http";
import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, "public");

// Load settings from a local .env file if there is one (see .env.example).
const envFile = path.join(here, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const PORT = Number(process.env.PORT) || 3000;
// Listens on this machine only by default: the chat endpoint spends your API
// credit and has no login, so don't expose it to a network without adding one.
const HOST = process.env.HOST || "127.0.0.1";

const MODEL = "claude-opus-5-5";
const MAX_TOKENS = 64000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const DEFAULT_NAME = "Nova";

// Reads ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN / an `ant auth login` profile).
const client = new Anthropic();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

function buildSystemPrompt(botName, instructions) {
  const name = botName || DEFAULT_NAME;
  let prompt =
    `You are ${name}, an AI assistant chatting with someone in a web chat app. ` +
    `Be warm, clear and genuinely helpful, and match the length of your reply to the question. ` +
    `The app renders Markdown, so use it where it helps (code blocks for code).`;
  if (instructions) {
    prompt += `\n\nThe person using this app has set these extra instructions for you:\n${instructions}`;
  }
  return prompt;
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const err = new Error("Request is too large.");
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const err = new Error("Request body is not valid JSON.");
    err.status = 400;
    throw err;
  }
}

// Returns the cleaned request, or throws an Error with .status = 400.
function parseChatRequest(body) {
  const fail = (message) => {
    const err = new Error(message);
    err.status = 400;
    return err;
  };
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    throw fail("`messages` must be a non-empty list.");
  }
  const messages = body.messages.map((m) => {
    const okRole = m && (m.role === "user" || m.role === "assistant");
    if (!okRole || typeof m.content !== "string" || !m.content.trim()) {
      throw fail("Each message needs a role (user or assistant) and some text.");
    }
    return { role: m.role, content: m.content };
  });
  if (messages[0].role !== "user" || messages.at(-1).role !== "user") {
    throw fail("The conversation must start and end with a user message.");
  }
  const text = (value, max) =>
    typeof value === "string" ? value.trim().slice(0, max) : "";
  return {
    messages,
    botName: text(body.botName, 40),
    instructions: text(body.instructions, 4000),
  };
}

// Turns an SDK error into a message a person can act on.
function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) {
    return "Your Anthropic API key was rejected. Check ANTHROPIC_API_KEY in your .env file and restart the server.";
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return "Your API key doesn't have permission to use this model.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Rate limit reached. Wait a moment and try again.";
  }
  if (err instanceof Anthropic.BadRequestError) {
    return `The request was rejected: ${err.message}`;
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Couldn't reach the Claude API. Check your internet connection and try again.";
  }
  if (err instanceof Anthropic.APIError) {
    return `The Claude API returned an error (${err.status ?? "unknown"}). Try again in a moment.`;
  }
  if (err instanceof Anthropic.AnthropicError) {
    // Raised before any request is made — typically no credentials were found.
    return "No Anthropic API key found. Copy .env.example to .env, add your key, and restart the server.";
  }
  return "Something went wrong on the server.";
}

async function handleChat(req, res) {
  let chat;
  try {
    chat = parseChatRequest(await readJsonBody(req));
  } catch (err) {
    return sendJson(res, err.status || 400, { error: err.message });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  let stream;
  // Stop generating (and stop paying for tokens) if the browser goes away.
  res.on("close", () => {
    if (!res.writableEnded) stream?.abort();
  });

  try {
    stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { effort: "medium" },
      // If a safety classifier declines a request, let the API retry it on
      // Anthropic's recommended fallback model instead of failing the turn.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      cache_control: { type: "ephemeral" },
      system: buildSystemPrompt(chat.botName, chat.instructions),
      messages: chat.messages,
    });

    for await (const event of stream) {
      if (event.type === "content_block_start") {
        if (event.content_block.type === "thinking") send({ type: "thinking" });
      } else if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        send({ type: "text", text: event.delta.text });
      }
    }

    const message = await stream.finalMessage();
    send({ type: "done", stop_reason: message.stop_reason, model: message.model });
  } catch (err) {
    if (err instanceof Anthropic.APIUserAbortError) return; // browser hit Stop
    console.error("Chat request failed:", err);
    send({ type: "error", message: describeError(err) });
  } finally {
    res.end();
  }
}

async function serveStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return sendJson(res, 400, { error: "Bad request." });
  }
  const filePath = path.join(PUBLIC_DIR, decoded === "/" ? "index.html" : decoded);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    return sendJson(res, 403, { error: "Forbidden." });
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch {
    sendJson(res, 404, { error: "Not found." });
  }
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  try {
    if (pathname === "/api/chat") {
      if (req.method !== "POST") return sendJson(res, 405, { error: "Use POST." });
      return await handleChat(req, res);
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return sendJson(res, 405, { error: "Method not allowed." });
    }
    return await serveStatic(req, res, pathname);
  } catch (err) {
    console.error("Unhandled server error:", err);
    if (!res.headersSent) sendJson(res, 500, { error: "Internal server error." });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Nova is running at http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.warn(
      "Heads up: no ANTHROPIC_API_KEY is set, so replies will fail. " +
        "Copy .env.example to .env and add your key.",
    );
  }
});
