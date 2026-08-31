#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:5173}"
TAG="${1:-ListPhotos}"
PAYLOAD="${2:-{}}"

ADMIN_TAGS="UpdatePhoto DeletePhoto CreateTag DeleteTag"
is_admin=0
for t in $ADMIN_TAGS; do
  if [ "$TAG" = "$t" ]; then is_admin=1; break; fi
done

if [ "$is_admin" -eq 1 ]; then
  URL="$BASE/api/admin/rpc"
else
  URL="$BASE/api/rpc"
fi

python3 -c "
import json, sys
tag = sys.argv[1]
payload = json.loads(sys.argv[2]) if sys.argv[2].strip() else {}
envelope = {'_tag': tag}
envelope.update(payload)
print(json.dumps(envelope))
" "$TAG" "$PAYLOAD" > /tmp/verify-photo-rpc-$$.json

echo "-> $URL _tag=$TAG payload=$PAYLOAD" >&2
curl -s -X POST "$URL" -H 'content-type: application/json' --data-binary @/tmp/verify-photo-rpc-$$.json
rm -f /tmp/verify-photo-rpc-$$.json
echo >&2
