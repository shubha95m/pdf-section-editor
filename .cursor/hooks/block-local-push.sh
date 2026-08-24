#!/bin/bash
# Cursor hook: block git push of local-only branches (for-use).
input=$(cat)
command=""
if command -v jq >/dev/null 2>&1; then
  command=$(echo "$input" | jq -r '.command // empty')
else
  command=$(python3 -c "import sys,json; print(json.load(sys.stdin).get('command',''))" <<< "$input" 2>/dev/null || true)
fi

ROOT="${CURSOR_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
BLOCKED_FILE="$ROOT/.githooks/blocked-branches.txt"

is_blocked_branch() {
  local branch="$1"
  [ -f "$BLOCKED_FILE" ] || return 1
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ""|"#"*) continue ;;
      *) [ "$line" = "$branch" ] && return 0 ;;
    esac
  done < "$BLOCKED_FILE"
  return 1
}

if [[ "$command" =~ ^git[[:space:]]+push ]]; then
  current=$(git -C "$ROOT" branch --show-current 2>/dev/null)

  if [ -n "$current" ] && is_blocked_branch "$current"; then
    cat <<EOF
{
  "permission": "deny",
  "user_message": "Blocked: branch '$current' is local-only and must not be pushed. Use master for GitHub.",
  "agent_message": "Push refused by block-local-push hook (.githooks/blocked-branches.txt)."
}
EOF
    exit 2
  fi

  for blocked in $(grep -v '^#' "$BLOCKED_FILE" 2>/dev/null | grep -v '^$'); do
    if [[ "$command" =~ $blocked ]]; then
      cat <<EOF
{
  "permission": "deny",
  "user_message": "Blocked: refusing to push branch '$blocked' (local-only).",
  "agent_message": "Push refused by block-local-push hook."
}
EOF
      exit 2
    fi
  done
fi

echo '{ "permission": "allow" }'
exit 0
