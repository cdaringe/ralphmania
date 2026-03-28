---
name: Orchestrator must deeply verify before declaring done
description: After merging worktrees, re-read BOTH spec and progress from disk and check for ID mismatches before declaring "All scenarios VERIFIED"
type: feedback
---

Never declare orchestrator completion based on stale in-memory data. Always
re-read both spec and progress files from disk after merges.

**Why:** Workers can modify the spec file (renaming/adding scenarios) or write
bogus IDs into progress. Using stale `expectedScenarioIds` from startup caused a
false "All scenarios VERIFIED" while IDs were mismatched. The user has been
burned by this multiple times.

**How to apply:** Any code path that can declare the orchestrator "done" must:
(1) re-read the spec file to get fresh scenario IDs, (2) re-read progress, (3)
check for ID mismatches (xor/difference), and (4) only then check if all are
VERIFIED. The `verifyCompletion` helper in state-machine.ts encapsulates this.
