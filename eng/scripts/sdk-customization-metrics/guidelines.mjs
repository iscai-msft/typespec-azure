// Publishes the customization guidelines (guidelines/*.md) as a page on the dashboard site,
// plus the raw Markdown so people and AI tools can fetch them. The renderer supports the
// subset the guidelines use: headings, paragraphs, lists, tables, code, links, bold.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LANGUAGES } from "./web/languages.mjs";

const GUIDELINES = new URL("./guidelines/", import.meta.url);

const escapeHtml = (text) =>
  text.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );

function inline(text, links) {
  const parts = [];
  // Code spans first, so their contents are never treated as markup.
  const pattern = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    parts.push(escapeHtml(text.slice(last, match.index)));
    if (match[1] !== undefined) parts.push(`<code>${escapeHtml(match[1])}</code>`);
    else if (match[2] !== undefined) {
      const href = links(match[3]);
      const label = inline(match[2], links);
      parts.push(
        href
          ? `<a href="${escapeHtml(href)}"${/^https:/.test(href) ? ' target="_blank" rel="noopener noreferrer"' : ""}>${label}</a>`
          : label,
      );
    } else parts.push(`<strong>${inline(match[4], links)}</strong>`);
    last = match.index + match[0].length;
  }
  parts.push(escapeHtml(text.slice(last)));
  return parts.join("");
}

const cells = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());

// Markdown to HTML. `links` maps an href to a safe URL (or "" to drop the link).
export function renderMarkdown(markdown, { links = (href) => href, idPrefix = "" } = {}) {
  const safeLinks = (href) => {
    const mapped = links(href);
    return /^(https:\/\/|#|\.\/)/.test(mapped) ? mapped : "";
  };
  const lines = markdown.replace(/^---\n[\s\S]*?\n---\n/, "").split(/\r?\n/);
  const html = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 5);
      const id = `${idPrefix}${heading[2]
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")}`;
      html.push(`<h${level} id="${id}">${inline(heading[2], safeLinks)}</h${level}>`);
      index++;
    } else if (line.startsWith("```")) {
      const code = [];
      index++;
      while (index < lines.length && !lines[index].startsWith("```")) code.push(lines[index++]);
      index++;
      html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
    } else if (line.trim().startsWith("|") && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] ?? "")) {
      const head = cells(line);
      index += 2;
      const body = [];
      while (index < lines.length && lines[index].trim().startsWith("|"))
        body.push(cells(lines[index++]));
      html.push(
        `<div class="table-scroll"><table><thead><tr>${head.map((cell) => `<th>${inline(cell, safeLinks)}</th>`).join("")}</tr></thead><tbody>${body
          .map(
            (row) =>
              `<tr>${row.map((cell) => `<td>${inline(cell, safeLinks)}</td>`).join("")}</tr>`,
          )
          .join("")}</tbody></table></div>`,
      );
    } else if (/^\s*(?:[-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (index < lines.length && /^\s*(?:[-*]|\d+\.)\s+/.test(lines[index])) {
        let item = lines[index++].replace(/^\s*(?:[-*]|\d+\.)\s+/, "");
        // Continuation lines are indented.
        while (
          index < lines.length &&
          /^\s{2,}\S/.test(lines[index]) &&
          !/^\s*(?:[-*]|\d+\.)\s+/.test(lines[index])
        )
          item += ` ${lines[index++].trim()}`;
        items.push(`<li>${inline(item, safeLinks)}</li>`);
      }
      html.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
    } else {
      const paragraph = [];
      while (
        index < lines.length &&
        lines[index].trim() &&
        !/^(#{1,4}\s|```|\s*\||\s*(?:[-*]|\d+\.)\s)/.test(lines[index])
      )
        paragraph.push(lines[index++].trim());
      html.push(`<p>${inline(paragraph.join(" "), safeLinks)}</p>`);
    }
  }
  return html.join("\n");
}

// Version of each language's guidelines; reviews made under other versions are re-done.
export async function guidelineVersions() {
  const versions = {};
  const general = await readFile(new URL("SKILL.md", GUIDELINES), "utf8");
  for (const language of LANGUAGES) {
    const text = await readFile(new URL(`${language.id}.md`, GUIDELINES), "utf8").catch(() => "");
    versions[language.id] = createHash("sha256")
      .update(general)
      .update(text)
      .digest("hex")
      .slice(0, 16);
  }
  return versions;
}

export async function readGuidelines(languageId) {
  const general = await readFile(new URL("SKILL.md", GUIDELINES), "utf8");
  const specific = await readFile(new URL(`${languageId}.md`, GUIDELINES), "utf8").catch(() => "");
  return { general, specific };
}

// Writes guidelines.html and guidelines/*.md into the site directory.
export async function exportGuidelines(outputDirectory, { repository, branch } = {}) {
  const repo = repository ?? process.env.GITHUB_REPOSITORY ?? "iscai-msft/typespec-azure";
  const ref = branch ?? process.env.GITHUB_REF_NAME ?? "sdk-customization-metrics";
  const folder = "eng/scripts/sdk-customization-metrics/guidelines";
  await mkdir(join(outputDirectory, "guidelines"), { recursive: true });
  const files = [{ id: "overview", file: "SKILL.md", label: "All languages" }].concat(
    LANGUAGES.map((language) => ({
      id: language.id,
      file: `${language.id}.md`,
      label: language.label,
    })),
  );
  const sections = [];
  for (const entry of files) {
    const markdown = await readFile(new URL(entry.file, GUIDELINES), "utf8").catch(() => null);
    if (markdown === null) continue;
    await writeFile(join(outputDirectory, "guidelines", entry.file), markdown);
    // Links between guideline files become in-page anchors.
    const links = (href) => {
      const sibling = /^\.\/([a-z]+)\.md$/.exec(href);
      if (sibling) return `#${sibling[1] === "skill" ? "overview" : sibling[1]}`;
      return href;
    };
    sections.push(`<section class="panel guideline" id="${entry.id}" aria-labelledby="${entry.id}-title">
  <div class="guideline-head">
    <h2 id="${entry.id}-title">${escapeHtml(entry.label)}</h2>
    <span class="guideline-links"><a href="https://github.com/${repo}/edit/${ref}/${folder}/${entry.file}" target="_blank" rel="noopener noreferrer">Propose a change</a> · <a href="./guidelines/${entry.file}">Raw Markdown</a></span>
  </div>
  ${renderMarkdown(markdown.replace(/^(---\n[\s\S]*?\n---\n)?\s*# .*\n/, ""), {
    links,
    idPrefix: `${entry.id}-`,
  })}
</section>`);
  }
  const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'none'; style-src 'self'; object-src 'none'; base-uri 'none'" />
    <title>Customization guidelines · Azure SDK Customization Metrics</title>
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
    <a class="skip-link" href="#main">Skip to guidelines</a>
    <header class="page-header">
      <div class="header-inner">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">SDK</span>
          <div class="brand-copy">
            <h1>Customization guidelines</h1>
            <p>What counts as handwritten customization code in each language</p>
          </div>
        </div>
        <nav aria-label="Guidelines">
          <a href="./index.html">Dashboard</a>${files.map((entry) => `<a href="#${entry.id}">${escapeHtml(entry.label)}</a>`).join("")}
        </nav>
      </div>
    </header>
    <main id="main">
      <p class="guideline-intro">These definitions are shared by reviewers and the AI review. Language specialists own their section: use “Propose a change” to open a pull request. Changing a language's guidelines re-runs AI review for that language. To overrule one finding instead, use the review controls on the dashboard.</p>
${sections.join("\n")}
    </main>
  </body>
</html>
`;
  await writeFile(join(outputDirectory, "guidelines.html"), page);
}
