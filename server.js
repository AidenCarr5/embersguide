const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8767);
const AI_PROVIDER = (process.env.AI_PROVIDER || "ollama").toLowerCase();
const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma3:1b";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error("Request body too large."));
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Request body was not valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function promptMessages(context) {
  const instructions = [
    "You are a warm, conversational planning assistant for Girl Guides leaders running Ember meetings.",
    "You can help match activities to badges, improve a proposed activity, recommend meeting ideas, suggest supplies, adapt activities for time/age/space, and help turn rough ideas into a practical plan.",
    "Use the provided badge context, group progress, meeting details, plans, and badge rules when they are relevant.",
    "If a badge recommendation is requested, recommend badges that could reasonably count, explain why in plain language, and mention any judgment calls.",
    "If the user is asking for recommendations or improvements, give practical, Ember-friendly suggestions even if there is not a perfect badge match.",
    "Use the conversation history so follow-up questions make sense.",
    "Ask one short clarifying question only when it would materially change the recommendation.",
    "Remind the leader that badge credit should be logged only for Embers marked present.",
    "Keep the answer concise, friendly, and easy to scan. Do not invent badge names.",
  ].join(" ");
  const conversation = Array.isArray(context.conversation) ? context.conversation.slice(-10) : [];
  const latest = String(context.prompt || conversation.filter((message) => message.role === "user").at(-1)?.content || "").trim();
  const prior = conversation
    .filter((message) => ["user", "assistant"].includes(message.role) && message.content)
    .filter((message, index, list) => !(index === list.length - 1 && message.role === "user" && String(message.content).trim() === latest));
  const contextForModel = { ...context, conversation: undefined };
  return [
    { role: "system", content: instructions },
    ...prior,
    { role: "user", content: `User message:\n${latest}\n\nCurrent badge, meeting, planning, and group context JSON:\n${JSON.stringify(contextForModel)}` },
  ];
}

function openAiOutputText(data) {
  if (typeof data.output_text === "string") return data.output_text.trim();
  return (data.output || [])
    .flatMap((item) => item.content || [])
    .map((part) => part.text || part.output_text || "")
    .join("\n")
    .trim();
}

async function ollamaChat(context) {
  const apiResponse = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: promptMessages(context),
      stream: false,
      options: {
        temperature: 0.3,
        num_predict: 700,
      },
    }),
  });

  const data = await apiResponse.json().catch(() => ({}));
  if (!apiResponse.ok) throw new Error(data.error || `Ollama request failed with status ${apiResponse.status}.`);
  const answer = data.message?.content?.trim();
  if (!answer) throw new Error("Ollama returned no answer.");
  return answer;
}

async function openAiChat(context) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const apiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: promptMessages(context)[0].content,
      input: `Badge and meeting context JSON:\n${JSON.stringify(context)}`,
      max_output_tokens: 900,
    }),
  });

  const data = await apiResponse.json();
  if (!apiResponse.ok) throw new Error(data.error?.message || "OpenAI request failed.");
  return openAiOutputText(data);
}

async function handleChat(request, response) {
  const context = await readJson(request);
  const answer = AI_PROVIDER === "openai" ? await openAiChat(context) : await ollamaChat(context);
  sendJson(response, 200, { answer, provider: AI_PROVIDER, model: AI_PROVIDER === "openai" ? OPENAI_MODEL : OLLAMA_MODEL });
}

function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(ROOT, `.${requested}`);

  if (!filePath.startsWith(ROOT)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream" });
    response.end(content);
  });
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/api/chat") {
      await handleChat(request, response);
      return;
    }
    if (request.method === "GET" || request.method === "HEAD") {
      serveStatic(request, response);
      return;
    }
    response.writeHead(405);
    response.end("Method not allowed");
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Server error." });
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.log(`Embers Tracker is already running at http://127.0.0.1:${PORT}/`);
    return;
  }
  throw error;
});

server.listen(PORT, () => {
  console.log(`Ember Badge Studio running at http://127.0.0.1:${PORT}/`);
  if (AI_PROVIDER === "openai") {
    console.log(process.env.OPENAI_API_KEY ? `OpenAI chat enabled with ${OPENAI_MODEL}.` : "OpenAI chat selected, but OPENAI_API_KEY is not set.");
  } else {
    console.log(`Ollama chat enabled with ${OLLAMA_MODEL} at ${OLLAMA_BASE_URL}.`);
  }
});
