#!/usr/bin/env bash
set -euo pipefail

PR_NUMBER="${1:?PR number required}"
REPO="${2:-$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)}"

if [[ -z "${REPO}" ]]; then
  echo "fetch.sh: cannot determine repo — pass <owner/repo> as second argument" >&2
  exit 2
fi

OWNER="${REPO%/*}"
NAME="${REPO#*/}"

GH_VERSION="$(gh --version | head -n1 | awk '{print $3}')"
GH_MAJOR="${GH_VERSION%%.*}"
GH_REST="${GH_VERSION#*.}"
GH_MINOR="${GH_REST%%.*}"
if (( GH_MAJOR < 2 )) || { (( GH_MAJOR == 2 )) && (( GH_MINOR < 40 )); }; then
  echo "fetch.sh: gh ${GH_VERSION} is too old — need >= 2.40 for statusCheckRollup" >&2
  exit 3
fi

PR_VIEW=$(gh pr view "$PR_NUMBER" -R "$REPO" \
  --json number,state,headRefOid,url,comments,reviews,statusCheckRollup)

INLINE=$(gh api --paginate -H "Accept: application/vnd.github+json" \
  "repos/$OWNER/$NAME/pulls/$PR_NUMBER/comments?per_page=100")

THREADS=$(gh api graphql -f query='
  query($owner:String!,$name:String!,$num:Int!){
    repository(owner:$owner,name:$name){
      pullRequest(number:$num){
        reviewThreads(first:100){
          nodes{ isResolved isOutdated comments(first:100){ nodes{ databaseId } } }
        }
      }
    }
  }' -F owner="$OWNER" -F name="$NAME" -F num="$PR_NUMBER")

VIEWER=$(gh api user -q .login)

RESOLVED_MAP=$(echo "$THREADS" | jq -c '
  [.data.repository.pullRequest.reviewThreads.nodes[]
    | . as $t
    | $t.comments.nodes[]
    | { key: (.databaseId|tostring),
        value: { isResolved: $t.isResolved, isOutdated: $t.isOutdated } }
  ] | from_entries')

HEAD_SHA=$(echo "$PR_VIEW" | jq -r .headRefOid)

jq -n \
  --argjson pr "$PR_VIEW" \
  --argjson inline "$INLINE" \
  --argjson resolved "$RESOLVED_MAP" \
  --arg viewer "$VIEWER" \
  --arg head "$HEAD_SHA" \
  '{
     pr: { number: $pr.number, state: $pr.state, headSha: $head, url: $pr.url },
     viewerLogin: $viewer,
     checks: ($pr.statusCheckRollup // [] | map({ name: (.name // .context // "check"), conclusion: (.conclusion // .state // "PENDING"), url: (.detailsUrl // .targetUrl // "") })),
     summaryComments: (
       ($pr.comments // [] | map({
         id: (.id|tostring), author: (.author.login // "unknown"),
         createdAt: .createdAt, body: .body, url: (.url // "")
       }))
       +
       ($pr.reviews // [] | map(select((.body // "") != "")) | map({
         id: (.id|tostring), author: (.author.login // "unknown"),
         createdAt: .submittedAt, body: .body, url: (.url // "")
       }))
     ),
     inlineComments: ($inline | map({
       id: (.id|tostring),
       author: (.user.login // "unknown"),
       createdAt: .created_at,
       path: .path,
       line: (.line // .original_line),
       body: .body,
       commitId: .commit_id,
       url: .html_url,
       isOutdated: ($resolved[(.id|tostring)].isOutdated // ((.commit_id // "") != $head)),
       isResolved: ($resolved[(.id|tostring)].isResolved // false)
     }))
   }'
