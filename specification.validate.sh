#!/usr/bin/env bash
set -euo pipefail

# specification.validate.sh
# Validates that specification requirements are met.
# Fill in your validation logic below.
# Exit 0 on success, non-zero on failure.
# stdout/stderr will be captured and provided to the agent on failure.
deno fmt
deno run check
deno run test
