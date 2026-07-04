const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const publishRoot = ".confluence-publish";
const diagramDir = path.join(publishRoot, "assets", "confluence-diagrams");

// Function that goes through each directory and
// finds .md files
function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);

    // Skip problematic directories
    if (entry.isDirectory()) {
      if (
        entry.name === ".git" ||
        entry.name === "node_modules" ||
        entry.name === "assets"
      ) {
        return [];
      }

      return walk(fullPath);
    }

    return fullPath.endsWith(".md") ? [fullPath] : [];
  });
}

// Create nested directories
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// Find relative path
function posixRelative(fromFile, toFile) {
  const fromDir = path.dirname(fromFile);
  return path.relative(fromDir, toFile).split(path.sep).join("/");
}

ensureDir(diagramDir);

const markdownFiles = walk(publishRoot);
const mermaidBlockRegex = /```mermaid\s*\n([\s\S]*?)```/g;

// Loop through each markdown files and
// replace mermaid markdown blocks with images
for (const file of markdownFiles) {
  const original = fs.readFileSync(file, "utf8");
  let changed = false;
  let index = 0;

  const updated = original.replace(mermaidBlockRegex, (match, mermaidSource) => {
    changed = true;

    const hash = crypto
      .createHash("sha1")
      .update(file + ":" + index + ":" + mermaidSource)
      .digest("hex")
      .slice(0, 12);

    const baseName = path
      .relative(publishRoot, file)
      .replace(/\.md$/, "")
      .replace(/[\\/]/g, "-")
      .replace(/[^a-zA-Z0-9-_]/g, "-");

    const diagramName = `${baseName}-${hash}`;
    const mmdPath = path.join(diagramDir, `${diagramName}.mmd`);
    const svgPath = path.join(diagramDir, `${diagramName}.svg`);

    fs.writeFileSync(mmdPath, mermaidSource.trim() + "\n", "utf8");

    execFileSync(
        "npx",
        [
            "-y",
            "@mermaid-js/mermaid-cli",
            "-p",
            ".mermaid-puppeteer.json",
            "-i",
            mmdPath,
            "-o",
            svgPath,
        ],
        {
            stdio: "inherit",
            env: {
            ...process.env,
            PUPPETEER_SKIP_DOWNLOAD: "true",
            PUPPETEER_EXECUTABLE_PATH:
                process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
            },
        }
    );

    index += 1;

    const imagePath = posixRelative(file, svgPath);

    return `![Mermaid diagram](${imagePath})`;
  });

  if (changed) {
    fs.writeFileSync(file, updated, "utf8");
    console.log(`Converted Mermaid diagrams in ${file}`);
  }
}