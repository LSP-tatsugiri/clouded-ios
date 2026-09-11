# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project summary

Clouded is an iOS app. This repository is currently a minimal scaffold: there is no Xcode project, Swift package, source code, or build/test setup yet. The only content is this documentation.

## Working conventions

- Keep changes small, focused, and consistent with the repository's current minimal footprint.
- Do not assume a large app architecture exists — create only the structure needed for the task at hand.
- If the project grows, prefer preserving simple, testable boundaries instead of adding abstraction layers prematurely.
- When adding files, keep naming, grouping, and folder layout straightforward and Xcode-friendly.
- Prefer clear, Swift-native patterns when adding iOS app code.
- Before claiming a feature is complete, check whether an Xcode project or Swift package configuration has since been added. If one exists, use its existing conventions rather than inventing new commands or toolchains.
- Ask for clarification when project direction is ambiguous rather than making architectural guesses, since the repo is still under-specified.

## Build and validation

There is no established build/test workflow in this repo yet. Do not invent build/lint/test commands — check for an Xcode project (`.xcodeproj`/`.xcworkspace`) or `Package.swift` first, and use whatever conventions it defines.
