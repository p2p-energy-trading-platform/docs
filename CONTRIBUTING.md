# Contributing Guidelines

**NOTE**: This is just a boilerplate. I will update this once everything is set up and I have confirmed about the usual workflow (contribution process) with vidurshan and keeththigan.

This document applies to the full P2P Energy Trading Platform project, not only this documentation repository. Use it for any research notes, design decisions, implementation plans, and future code repositories that belong to the project.

## How To Contribute

1. Start with an issue, proposal, or clear note describing the change.
2. Keep changes small and focused so they are easy to review.
3. Prefer one topic per pull request or document update.
4. If a change affects multiple areas, explain the dependency between them clearly.

## Working Practices

- Check existing documents before adding new content to avoid duplication.
- Add new research, assumptions, and implementation ideas in the most relevant place.
- When a decision is made, update the related document so the project stays consistent.
- Use clear filenames and headings that make content easy to scan later.

## Writing Standards

- Write in plain, direct language.
- Keep terminology consistent across the project.
- Prefer short sections, bullets, and examples over long paragraphs when documenting technical work.
- If you add requirements or design choices, state the reason behind them (or just provide an explanation).

## Review Checklist

Before submitting a change, confirm that:

- the change matches the project scope and current goals,
- the content is accurate and does not duplicate existing notes,
- any assumptions or open questions are clearly marked,
- formatting is clean and consistent with the surrounding documents.

## For Future Code Contributions

When new code repositories are added to this project (which they obviously will), follow the same principles:

- make changes incrementally,
- include tests or validation where practical,
- document behavior changes that affect the wider project,
- keep implementation aligned with the shared project goals.

## Git Commit Guidelines

**NOTE**: You can use your own commit message format/styles but make sure your commits are meaningful, reasonable and short (or even detailed commits are fine for some cases).

We can use the Conventional Commits specification to keep our repository history clean and readable. Or you can use your own commit formats so no issues!! However strictly avoid commits that do lots of changes or commit messages that are unnecessarily longer than needed.

### Message Format
Each commit message **can** use the following structure:

```
type(scope): short summary
```

- **type**: Matches the nature of the change (see types below).
- **scope (Optional)**: The specific module or area affected (e.g., `smart-contract`, `ui`, `api`, `docs`).
- **short summary**: A short, present-tense description of the change in lowercase. Do not end with a period.

### Allowed Types

| Type | Description |
| :--- | :--- |
| `feat` | A new feature |
| `fix` | A bug fix |
| `doc` | Documentation changes only |
| `style` | Changes that do not affect code meaning (formatting, white-space) |
| `refactor` | A code change that neither fixes a bug nor adds a feature |
| `perf` | A code change that improves performance |
| `test` | Adding or updating tests |
| `chore` | Changes to the build process, dependencies, or auxiliary tools |
| `remove` | Changes that remove/delete files/code/logic |

### Examples
- `feat(api): add order matching logic for energy trading`
- `fix(smart-contract): resolve token balance overflow on settlement`
- `docs: update setup steps in readme`

### What NOT to do when committing

To prevent cluttering the commit history, avoid these common anti-patterns:

- **Do not write generic summaries:** Avoid titles like `fix`, `updates`, `changes`, or `debug`. Be specific.
- **Do not bundle unrelated changes:** Avoid fixing a bug and adding a new feature in a single commit. Split them up.
- **Do not commit unfinished work:** Avoid committing half-written code that breaks the compilation or build pipeline. Use stashes or local branches instead.
- **Do not include sensitive data:** Never commit secrets, private API keys, configuration credentials, or `.env` files into the repository tracker.
- **Do not commit several different changes under one commit:** Do not do this because it will make the intent not clear when we refer the commit history and can also prevent reverts if something broke.