# Nova — your own AI chatbot

A personal AI assistant with its own web chat interface. Nova streams replies as
they're written, remembers your conversations in the browser, and can be renamed
and given any personality you like. Replies come from Claude through the
Anthropic API.

## Run it

You need [Node.js](https://nodejs.org) 20.12 or newer and an Anthropic API key
(create one at <https://platform.claude.com/settings/keys>).

```bash
npm install
cp .env.example .env      # then open .env and paste your API key
npm start
```

Open <http://localhost:3000> and start chatting.

## What it can do

- **Streaming replies** with a Stop button, so you can cut a long answer short.
- **Multiple chats**, saved in your browser and listed in the sidebar.
- **Personalize** — give the AI a different name and your own instructions
  ("talk like a pirate", "keep answers short", "help me practice Spanish").
- **Formatted answers** — headings, lists, tables, links and code blocks with a
  copy button.
- **Light and dark themes** that follow your device, and a layout that works on
  phones.

## How it's put together

| File | What it does |
| --- | --- |
| `server.js` | Small Node server: serves the page and streams replies from Claude at `POST /api/chat`. |
| `public/index.html`, `public/style.css` | The chat page and its look. |
| `public/app.js` | Chat logic: sending, streaming, saved chats, settings. |
| `public/markdown.js` | Turns the AI's Markdown into safe HTML. |

Things you may want to change in `server.js`:

- `MODEL` — which Claude model answers (`claude-opus-5-5` by default).
- `buildSystemPrompt` — the AI's built-in personality.

## Good to know

- Your API key stays on the server (in `.env`, which git ignores). It is never
  sent to the browser.
- Chats are stored only in your browser's local storage. Clearing site data
  deletes them.
- Each message costs API credit, billed to your Anthropic account.
- The server listens on your own computer only. There is no login, so if you put
  it on the internet (`HOST=0.0.0.0`), add one first — otherwise anyone who finds
  it can spend your credit.
