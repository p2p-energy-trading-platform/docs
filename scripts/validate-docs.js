const fs = require("fs");
const path = require("path");

const ROOT = process.argv[2] || ".";
const titleMap = new Map();
const errors = [];

const ignoredDirs = new Set([
    ".git",
    ".github",
    "node_modules",
    ".confluence-publish",
]);

function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            if (!ignoredDirs.has(entry.name)) {
                walk(fullPath);
            }
            continue;
        }

        if (entry.isFile() && entry.name.endsWith(".md")) {
            validateMarkdownFile(fullPath);
        }
    }
}

function validateMarkdownFile(filePath) {
    const content = fs.readFileSync(filePath, "utf8");

    // Front matter must be the first thing in the file.
    if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
        errors.push(
            `${filePath}: missing YAML front matter at the very top of the file. Expected first line to be "---".`
        );
        return;
    }

    const normalized = content.replace(/\r\n/g, "\n");
    const closingIndex = normalized.indexOf("\n---\n", 4);

    if (closingIndex === -1) {
        errors.push(`${filePath}: YAML front matter is not closed with "---".`);
        return;
    }

    const frontMatter = normalized.slice(4, closingIndex).trim();

    const titleMatch = frontMatter.match(/^connie-title:\s*(.+?)\s*$/m);

    if (!titleMatch) {
        errors.push(`${filePath}: missing required "connie-title" in front matter.`);
        return;
    }

    const rawTitle = titleMatch[1].trim();
    const title = rawTitle.replace(/^['"]|['"]$/g, "").trim();

    if (!title) {
        errors.push(`${filePath}: "connie-title" must not be empty.`);
        return;
    }

    if (title.toLowerCase() === "readme") {
        errors.push(
            `${filePath}: "connie-title" must not be generic "README". Use a meaningful unique Confluence page title.`
        );
    }

    if (titleMap.has(title)) {
        errors.push(
            `${filePath}: duplicate connie-title "${title}". Already used in ${titleMap.get(
                title
            )}.`
        );
    } else {
        titleMap.set(title, filePath);
    }
}

walk(ROOT);

if (errors.length > 0) {
    console.error("\nDocumentation validation failed:\n");

    for (const error of errors) {
        console.error(`- ${error}`);
    }

    console.error(`\nTotal errors: ${errors.length}`);
    process.exit(1);
}

console.log(`Validated ${titleMap.size} Markdown files.`);
console.log("All Markdown files have unique connie-title front matter.");