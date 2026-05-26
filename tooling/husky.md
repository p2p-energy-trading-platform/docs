# Husky Commit Hooks

Husky is the hook manager we will use to run local Git hooks for this project.

## Why we use it

- Keep commit messages consistent.
- Catch simple mistakes before code reaches a pull request.
- Make the local workflow match the team rules documented in [Contributing Guidelines](../CONTRIBUTING.md).

## Expected behavior

The hook setup should help with:

- checking commit message format before a commit is accepted,
- running any lightweight local checks we decide are safe to execute before commit,
- guiding contributors toward the project commit style described in [Contributing Guidelines](../CONTRIBUTING.md#git-commit-guidelines).

## Suggested setup flow

1. Install Husky in the repository.
2. Add the hook files under the Git hooks directory managed by Husky.
3. Define the checks that should run locally.
4. Keep the hook fast so contributors do not have to wait too long before committing.

## Notes for the team

- Do not put heavy tests in the hook unless we explicitly agree on it.
- Keep the hook messages short and actionable.

