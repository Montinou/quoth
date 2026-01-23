---
name: quoth-genesis
description: Bootstrap Quoth documentation for the current project
---

# Quoth Genesis Skill

## Overview

This skill triggers the Quoth Genesis process to create initial documentation for your project.

## Usage

```
/quoth-genesis
```

## What Happens

1. **Project Detection**: Identifies your project's tech stack
2. **Depth Selection**: Choose documentation depth:
   - **Minimal** (3 docs, ~3 min): Quick overview
   - **Standard** (5 docs, ~7 min): Team onboarding
   - **Comprehensive** (11 docs, ~20 min): Full documentation

3. **Document Generation**: Creates documentation for:
   - Project overview
   - Tech stack
   - Repository structure
   - Coding conventions
   - Testing patterns
   - And more (depending on depth)

4. **AI Tool Configuration**: Updates CLAUDE.md or creates QUOTH_DOCS.md

## Trigger

To run Genesis, call the `quoth_genesis` tool:

```
quoth_genesis({ depth_level: "standard", focus: "full_scan" })
```

## Post-Genesis

After Genesis completes:
- Documentation is uploaded to Quoth
- Coverage metrics are calculated
- AI tools are configured to use Quoth

Run `/quoth-genesis` again to update existing documentation.
