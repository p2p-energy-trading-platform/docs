---
connie-title: Commit Workflow
---

# Commit Workflow

This page explains three tools we can use to manage commit messages and staged files.

## Why we use them

- Husky runs Git hooks.
- commitlint checks commit messages.
- lint-staged runs formatters and linters only on staged files.

## How they work together

1. Husky runs the hook when you commit.
2. commitlint checks if the commit message is valid.
3. lint-staged runs checks only on the files you have staged.

## Simple installation guide

1. Make sure Node.js and npm are installed.
1. Install the tools in the project:

 ```bash
 npm install --save-dev husky @commitlint/cli @commitlint/config-conventional lint-staged
 ```

1. Turn on Husky:

 ```bash
 npx husky init
 ```

1. Add a `commit-msg` hook for commitlint.
1. Add a `pre-commit` hook for lint-staged.
1. Keep the checks small and fast.

## Why this setup is useful

- It keeps commit messages in one style.
- It keeps checks fast because they run only on changed files.
- It helps us catch small mistakes before code is committed.

## Notes for the team

- This setup is best for Node.js projects.
- If we work on Python or Go projects, we should research a better hook tool for that language first.
- Keep hooks simple and fast.
