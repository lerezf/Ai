import { renderMarkdown } from "/markdown.js";

const DEFAULT_NAME = "Nova";
const STORE_KEY = "nova.chats.v1";
const SETTINGS_KEY = "nova.settings.v1";

const SUGGESTIONS = [
  "Explain how black holes work like I'm ten",
  "Help me plan a fun weekend on a small budget",
  "Write a short poem about the ocean at night",
  "Give me 5 ideas for a simple game I could build",
];

const $ = (id) => document.getElementById(id);
const els = {
  app: $("app"),
  brandName: $("brand-name"),
  chatList: $("chat-list"),
  chatTitle: $("chat-title"),
  messages: $("messages"),
  composer: $("composer"),
  input: $("input"),
  send: $("send"),
  newChat: $("new-chat"),
  toggleSidebar: $("toggle-sidebar"),
  scrim: $("scrim"),
  openSettings: $("open-settings"),
  settings: $("settings"),
  settingsForm: $("settings-form"),
  settingsCancel: $("settings-cancel"),
  setName: $("set-name"),
  setInstructions: $("set-instructions"),
};

// ---------- Saved state (kept in this browser only) ----------

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be full or blocked (private windows); the chat still works.
  }
}

let chats = load(STORE_KEY, []);
if (!Array.isArray(chats)) chats = [];
let settings = { name: "", instructions: "", ...load(SETTINGS_KEY, {}) };
let current = null; // the open chat; not added to `chats` until its first message
let controller = null; // AbortController while a reply is streaming

const botName = () => settings.name.trim() || DEFAULT_NAME;
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const persist = () => save(STORE_KEY, chats);

// ---------- Rendering ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function applyBranding() {
  const name = botName();
  document.title = name;
  els.brandName.textContent = name;
  els.input.placeholder = `Message ${name}…`;
  document.querySelector(".hint").textContent =
    `Enter to send · Shift+Enter for a new line · ${name} can make mistakes.`;
}

function renderChatList() {
  els.chatList.replaceChildren();
  const sorted = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const chat of sorted) {
    const row = el("div", "chat-item" + (chat === current ? " active" : ""));
    const open = el("button", "open", chat.title);
    open.type = "button";
    open.title = chat.title;
    open.addEventListener("click", () => openChat(chat));
    const del = el("button", "delete", "×");
    del.type = "button";
    del.setAttribute("aria-label", `Delete chat: ${chat.title}`);
    del.addEventListener("click", () => deleteChat(chat));
    row.append(open, del);
    els.chatList.append(row);
  }
}

function messageNode(message) {
  const kind = message.notice ? "assistant notice" : message.role;
  const row = el("div", `msg ${kind}`);
  const bubble = el("div", "bubble");
  if (message.role === "assistant") {
    const avatar = el("img", "avatar");
    avatar.src = "/icon.svg";
    avatar.alt = "";
    row.append(avatar);
    if (message.notice) bubble.textContent = message.content;
    else bubble.innerHTML = renderMarkdown(message.content);
  } else {
    bubble.textContent = message.content;
  }
  row.append(bubble);
  return row;
}

function renderWelcome() {
  const wrap = el("div", "welcome");
  const icon = el("img");
  icon.src = "/icon.svg";
  icon.alt = "";
  icon.width = 72;
  icon.height = 72;
  const grid = el("div", "suggestions");
  for (const text of SUGGESTIONS) {
    const button = el("button", "suggestion", text);
    button.type = "button";
    button.addEventListener("click", () => sendMessage(text));
    grid.append(button);
  }
  wrap.append(
    icon,
    el("h2", "", `Hi, I'm ${botName()}`),
    el("p", "", "Your own AI. Ask me anything, or try one of these:"),
    grid,
  );
  return wrap;
}

function renderMessages() {
  els.chatTitle.textContent = current.title;
  els.messages.replaceChildren();
  if (current.messages.length === 0) {
    els.messages.append(renderWelcome());
  } else {
    for (const message of current.messages) els.messages.append(messageNode(message));
  }
  scrollToBottom(true);
}

function nearBottom() {
  const m = els.messages;
  return m.scrollHeight - m.scrollTop - m.clientHeight < 120;
}

function scrollToBottom(force = false) {
  if (force || nearBottom()) els.messages.scrollTop = els.messages.scrollHeight;
}

// ---------- Chats ----------

function startNewChat() {
  stopStreaming();
  current = { id: newId(), title: "New chat", messages: [], updatedAt: Date.now() };
  renderChatList();
  renderMessages();
  closeSidebar();
  els.input.focus();
}

function openChat(chat) {
  if (chat === current) return closeSidebar();
  stopStreaming();
  current = chat;
  renderChatList();
  renderMessages();
  closeSidebar();
}

function deleteChat(chat) {
  if (!confirm(`Delete "${chat.title}"? This can't be undone.`)) return;
  chats = chats.filter((c) => c !== chat);
  persist();
  if (chat === current) startNewChat();
  else renderChatList();
}

function titleFrom(text) {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 42 ? `${oneLine.slice(0, 42).trimEnd()}…` : oneLine;
}

// ---------- Sending & streaming ----------

function setBusy(busy) {
  els.send.classList.toggle("busy", busy);
  els.send.setAttribute("aria-label", busy ? "Stop generating" : "Send message");
  updateSendState();
}

function updateSendState() {
  els.send.disabled = !controller && !els.input.value.trim();
}

function stopStreaming() {
  controller?.abort();
}

function autosize() {
  els.input.style.height = "auto";
  els.input.style.height = `${Math.min(els.input.scrollHeight, 200)}px`;
}

function typingIndicator(label) {
  const wrap = el("span", "typing");
  const dots = el("span", "dots");
  dots.append(el("i"), el("i"), el("i"));
  wrap.append(dots);
  if (label) wrap.append(el("span", "", label));
  return wrap;
}

// Reads the server's event stream, calling onEvent for each JSON event.
async function readEvents(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split;
    while ((split = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      for (const line of block.split("\n")) {
        if (line.startsWith("data: ")) onEvent(JSON.parse(line.slice(6)));
      }
    }
  }
}

async function sendMessage(text) {
  const content = text.trim();
  if (!content || controller) return;

  const chat = current;
  if (chat.messages.length === 0) {
    chat.title = titleFrom(content);
    chats.push(chat);
    els.messages.replaceChildren();
  }
  const userMessage = { role: "user", content };
  chat.messages.push(userMessage);
  chat.updatedAt = Date.now();
  persist();
  renderChatList();
  els.chatTitle.textContent = chat.title;
  els.messages.append(messageNode(userMessage));

  els.input.value = "";
  autosize();

  // Placeholder row that fills in as the reply streams.
  const row = messageNode({ role: "assistant", content: "" });
  const bubble = row.querySelector(".bubble");
  bubble.replaceChildren(typingIndicator());
  els.messages.append(row);
  scrollToBottom(true);

  controller = new AbortController();
  const signal = controller.signal;
  setBusy(true);

  let reply = "";
  let problem = null; // text for a notice bubble, if the turn failed
  let frame = 0;
  const paint = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (current !== chat) return;
      const stick = nearBottom();
      bubble.innerHTML = renderMarkdown(reply);
      if (stick) scrollToBottom(true);
    });
  };

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        // Notices (errors shown in the chat) are for the reader, not the model.
        messages: chat.messages
          .filter((m) => !m.notice)
          .map(({ role, content }) => ({ role, content })),
        botName: settings.name,
        instructions: settings.instructions,
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `The server returned an error (${response.status}).`);
    }

    let finished = false;
    await readEvents(response, (event) => {
      if (event.type === "thinking") {
        if (!reply && current === chat) bubble.replaceChildren(typingIndicator("Thinking…"));
      } else if (event.type === "text") {
        reply += event.text;
        paint();
      } else if (event.type === "error") {
        finished = true;
        problem = event.message;
      } else if (event.type === "done") {
        finished = true;
        if (event.stop_reason === "refusal") {
          reply = "";
          problem = `${botName()} couldn't help with that request. Try rephrasing it or asking something else.`;
        } else if (event.stop_reason === "max_tokens") {
          problem = "That reply hit the length limit and was cut off. Ask me to continue.";
        }
      }
    });
    if (!finished && !signal.aborted) problem = "The connection dropped before the reply finished.";
  } catch (err) {
    if (!signal.aborted) {
      problem =
        err instanceof TypeError
          ? "Couldn't reach the server. Is it still running?"
          : err.message;
    }
  } finally {
    if (frame) cancelAnimationFrame(frame);
    controller = null;

    // Keep whatever was written (including a reply the user stopped part-way).
    if (reply.trim()) chat.messages.push({ role: "assistant", content: reply });
    if (problem) chat.messages.push({ role: "assistant", content: problem, notice: true });
    chat.updatedAt = Date.now();
    persist();

    if (current === chat) {
      const stick = nearBottom();
      row.remove();
      if (reply.trim()) els.messages.append(messageNode({ role: "assistant", content: reply }));
      if (problem) {
        els.messages.append(messageNode({ role: "assistant", content: problem, notice: true }));
      }
      if (stick) scrollToBottom(true);
    }
    setBusy(false);
    renderChatList();
  }
}

// ---------- Sidebar & settings ----------

function closeSidebar() {
  els.app.classList.remove("sidebar-open");
  els.scrim.hidden = true;
}

function openSettings() {
  els.setName.value = settings.name;
  els.setInstructions.value = settings.instructions;
  closeSidebar();
  els.settings.showModal();
}

// ---------- Events ----------

els.composer.addEventListener("submit", (event) => {
  event.preventDefault();
  if (controller) stopStreaming();
  else sendMessage(els.input.value);
});

els.input.addEventListener("input", () => {
  autosize();
  updateSendState();
});

els.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (!controller) sendMessage(els.input.value);
  }
});

els.newChat.addEventListener("click", startNewChat);

els.toggleSidebar.addEventListener("click", () => {
  const open = els.app.classList.toggle("sidebar-open");
  els.scrim.hidden = !open;
});
els.scrim.addEventListener("click", closeSidebar);

els.openSettings.addEventListener("click", openSettings);
els.settingsCancel.addEventListener("click", () => els.settings.close());
els.settingsForm.addEventListener("submit", () => {
  settings = {
    name: els.setName.value.trim(),
    instructions: els.setInstructions.value.trim(),
  };
  save(SETTINGS_KEY, settings);
  applyBranding();
  if (current.messages.length === 0) renderMessages();
});

// Copy buttons on code blocks.
els.messages.addEventListener("click", async (event) => {
  const button = event.target.closest(".copy");
  if (!button) return;
  const code = button.closest(".code-block")?.querySelector("code")?.textContent ?? "";
  try {
    await navigator.clipboard.writeText(code);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Copy failed";
  }
  setTimeout(() => (button.textContent = "Copy"), 1500);
});

// ---------- Start ----------

applyBranding();
startNewChat();
