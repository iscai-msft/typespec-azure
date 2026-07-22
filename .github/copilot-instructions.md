# Copilot Instructions

This document serves as an index to task-specific instructions for GitHub Copilot. Each task has its own detailed instructions file in the `.github/prompts` directory.

## Install and Build

- Packages are located in the `packages` folder
- Use `pnpm` as the package manager
- Use `pnpm install` to install dependencies
- Use `pnpm build` to build every package
- Use `pnpm -r --filter "<pkgName>..." build` to build to a specific package `<pkgName>`
- Use `pnpm format` to format all files

## Commit Rules

- Always run `pnpm format` before committing.
- Do not commit files under `core/` or `pnpm-lock.yaml` unless absolutely necessary. If these appear in your staged changes, unstage them before committing.

## Describing changes

- Repo use `@chronus/chronus` for changelogs
- Use `pnpm change add` to add a change description for the touched packages
- Types of changes are described in `.chronus/config.yaml`

## Branch and PR Workflow

- When creating worktrees or branches for new work, base them off the main Azure fork's `main` branch (Azure/typespec-azure). Depending on the user's local git remote setup, this may be called `upstream` or `origin`.
- When pushing changes and creating pull requests, push to your personal fork and open PRs against the main Azure fork's `main` branch.

## Available Task Instructions

- [Testserver Generation](./prompts/testserver-generation.md): Instructions for generating TypeSpec HTTP spec test servers
