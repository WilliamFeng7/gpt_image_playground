#!/usr/bin/env bash
set -euo pipefail

status=0
git merge --no-ff --no-commit "$1" || status=$?
git rev-parse --verify --quiet MERGE_HEAD >/dev/null || exit "$status"

# Fork 仅发布 macOS 客户端。上游提交仍保留在合并历史中。
git rm -q -r -f --ignore-unmatch -- \
  .dockerignore .github/ISSUE_TEMPLATE .github/workflows/deploy.yml \
  .github/workflows/docker.yml .github/workflows/tauri-release.yml \
  .github/workflows/vercel-tag-deploy.yml deploy docs/images \
  src-tauri/windows vercel.json wrangler.jsonc

conflicts=$(git diff --name-only --diff-filter=U)
if [[ -n "$conflicts" ]]; then
  printf '%s\n' "$conflicts" >&2
  exit 1
fi
