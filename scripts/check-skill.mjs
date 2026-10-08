import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = readFileSync(resolve(root, "skills/codebase-search/SKILL.md"), "utf8");
const generated = readFileSync(resolve(root, ".agents/skills/codebase-search/SKILL.md"), "utf8");
if (source !== generated) {
  console.error("generated skill is stale; copy skills/codebase-search/SKILL.md to .agents/skills/codebase-search/SKILL.md");
  process.exit(1);
}
console.log("generated skill is current");
