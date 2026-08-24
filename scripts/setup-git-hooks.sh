#!/bin/sh
# Point this repo at shared hooks in .githooks/ (run once after clone).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

chmod +x .githooks/pre-push
git config core.hooksPath .githooks

echo "Git hooks enabled: core.hooksPath=.githooks"
echo "Blocked from push: $(grep -v '^#' .githooks/blocked-branches.txt | grep -v '^$' | tr '\n' ' ')"
