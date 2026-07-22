---
name: Code Review
description: Review code changes for correctness, security, and regressions.
version: 1.0.0
taskTypes: [code-review, security]
requiredTools: [read_file, search_files, list_files, git_diff, git_status]
risk: low
---

Read the relevant implementation and tests before reporting findings. Use Git diff when reviewing pending changes. Report concrete issues with file references and avoid speculative style comments.
