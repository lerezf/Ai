// A small, safe Markdown renderer for chat replies.
// All text is HTML-escaped first; only the tags produced here ever reach the page.

const escapeHtml = (s) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Inline formatting: `code`, **bold**, *italic*, ~~strike~~, [links](url).
function inline(text) {
  const codeSpans = [];
  // Pull code spans out first so nothing inside them gets formatted.
  let out = text.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_, _ticks, code) => {
    codeSpans.push(`<code>${escapeHtml(code.trim())}</code>`);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });

  out = escapeHtml(out)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    })
    .replace(/\*\*([^\s*](?:[^*]*[^\s*])?)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^\s_](?:[^_]*[^\s_])?)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^\s*](?:[^*]*[^\s*])?)\*(?![*\w])/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_([^\s_](?:[^_]*[^\s_])?)_(?![_\w])/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");

  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => codeSpans[Number(i)] ?? "");
}

const isTableDivider = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const splitRow = (line) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

// Renders consecutive list lines (with nesting by indentation) starting at `start`.
function renderList(lines, start) {
  const baseIndent = lines[start].match(LIST_ITEM)[1].length;
  const ordered = /\d/.test(lines[start].match(LIST_ITEM)[2]);
  const items = [];
  let i = start;

  while (i < lines.length) {
    const match = lines[i].match(LIST_ITEM);
    if (!match) {
      // Indented continuation text belongs to the current item.
      if (lines[i].trim() && /^\s+/.test(lines[i]) && items.length) {
        items[items.length - 1] += " " + inline(lines[i].trim());
        i++;
        continue;
      }
      break;
    }
    const indent = match[1].length;
    if (indent < baseIndent) break;
    if (indent > baseIndent + 1 && items.length) {
      const nested = renderList(lines, i);
      items[items.length - 1] += nested.html;
      i = nested.next;
      continue;
    }
    if (/\d/.test(match[2]) !== ordered) break;
    items.push(inline(match[3]));
    i++;
  }

  const tag = ordered ? "ol" : "ul";
  return {
    html: `<${tag}>${items.map((item) => `<li>${item}</li>`).join("")}</${tag}>`,
    next: i,
  };
}

export function renderMarkdown(source) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const html = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block (an unclosed fence runs to the end, which is what we
    // want while a reply is still streaming in).
    const fence = line.match(/^\s*(```+|~~~+)\s*([\w+#.-]*)/);
    if (fence) {
      const closing = new RegExp(`^\\s*${fence[1][0]}{${fence[1].length},}\\s*$`);
      const code = [];
      i++;
      while (i < lines.length && !closing.test(lines[i])) code.push(lines[i++]);
      i++;
      html.push(
        `<div class="code-block"><div class="code-head"><span>${escapeHtml(fence[2] || "code")}</span>` +
          `<button class="copy" type="button">Copy</button></div>` +
          `<pre><code>${escapeHtml(code.join("\n"))}</code></pre></div>`,
      );
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2].replace(/\s+#+\s*$/, ""))}</h${level}>`);
      i++;
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      html.push("<hr />");
      i++;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      }
      html.push(`<blockquote>${renderMarkdown(quote.join("\n"))}</blockquote>`);
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const head = splitRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitRow(lines[i++]));
      }
      html.push(
        `<div class="table-wrap"><table><thead><tr>` +
          head.map((cell) => `<th>${inline(cell)}</th>`).join("") +
          `</tr></thead><tbody>` +
          rows
            .map((row) => `<tr>${head.map((_, c) => `<td>${inline(row[c] ?? "")}</td>`).join("")}</tr>`)
            .join("") +
          `</tbody></table></div>`,
      );
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const list = renderList(lines, i);
      html.push(list.html);
      i = list.next;
      continue;
    }

    // Paragraph: gather lines until a blank line or another block starts.
    const para = [lines[i++]];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(```|~~~|#{1,4}\s|>)/.test(lines[i]) &&
      !LIST_ITEM.test(lines[i])
    ) {
      para.push(lines[i++]);
    }
    html.push(`<p>${inline(para.join("\n")).replace(/\n/g, "<br />")}</p>`);
  }

  return html.join("");
}
