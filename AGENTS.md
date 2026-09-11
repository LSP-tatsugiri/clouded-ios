# AGENTS.md

## Project summary

This repository is a minimal iOS app scaffold for Clouded. The current codebase is intentionally small; the primary project documentation is the root [README.md](README.md).

## Working conventions for AI coding agents

- Keep changes small, focused, and consistent with the repository's current minimal footprint.
- Prefer clear, Swift-native patterns when adding iOS app code.
- Do not assume a large app architecture exists yet; create only the structure needed for the task at hand.
- If the project grows, prefer preserving simple, testable boundaries instead of adding abstraction layers prematurely.
- When adding files, keep naming, grouping, and folder layout straightforward and Xcode-friendly.

## Repository guidance

- Start by reading [README.md](README.md) for the current product intent before making changes.
- Because the repo is currently minimal, verify whether the requested work is adding an app feature, scaffolding files, or creating build/test setup before choosing a project structure.
- Avoid duplicating documentation already present in the repository; prefer linking to the relevant file instead of re-explaining it.

## Build and validation expectations

- There is no established build/test workflow in the repo yet.
- Before claiming a feature is complete, check whether the repository already contains an Xcode project or Swift package configuration.
- If an iOS project is later added, prefer the repository's existing project conventions over inventing new commands or toolchains.

## Good default behavior

- Favor small, reviewable PR-sized changes.
- Explain assumptions when the repository is still under-specified.
- Ask for clarification when project direction is ambiguous rather than making architectural guesses.

## Suggested next step when the app expands

If the workspace later grows into a real iOS app, add a focused instruction file for the relevant area (for example app UI, networking, storage, or testing) rather than broad, duplicate guidance.
