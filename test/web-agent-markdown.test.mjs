import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const markdown = fs.readFileSync(new URL("../web/src/components/Markdown.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");

test("the React Agent conversation renders sanitized Markdown responses", () => {
  assert.match(app, /import \{ Markdown \} from "\.\/components\/Markdown"/);
  assert.match(app, /<Markdown className="request-response-markdown" source=\{request\.response\} \/>/);
  assert.doesNotMatch(app, /<p>\{request\.response\}<\/p>/);
  assert.match(markdown, /marked\.parse\(source, \{[\s\S]*async: false,[\s\S]*gfm: true,[\s\S]*renderer: markdownRenderer/);
  assert.match(markdown, /DOMPurify\.sanitize\(rendered, sanitizerOptions\)/);
  assert.match(markdown, /markdownRenderer\.html = \(\{ text \}\) => escapeHtml\(text\)/);
  assert.match(markdown, /markdownRenderer\.image =/);
  assert.doesNotMatch(markdown, /"img"/);
  assert.match(markdown, /link\.rel = "noopener noreferrer"/);
  assert.match(styles, /\.request-response-markdown pre/);
  assert.match(styles, /\.request-response-markdown table/);
});
