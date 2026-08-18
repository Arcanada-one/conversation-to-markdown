#!/usr/bin/env bash
# Build the Chrome Web Store submission package.
#
# Exports from the COMMITTED tree, never the working directory: a package built
# from a dirty tree ships bytes that no tag points at, and that difference is
# invisible once the zip is uploaded.
#
# The package contains only what the extension loads at runtime. Everything else
# in the repository — tests, docs, CI config, the hero image — is repository
# content, and shipping it makes the download larger and the review surface
# wider for no benefit.
set -euo pipefail

cd "$(dirname "$0")"
ref="${1:-HEAD}"
version="$(git show "$ref:manifest.json" | sed -n 's/.*"version": "\([^"]*\)".*/\1/p')"
[ -n "$version" ] || { echo "could not read version from $ref:manifest.json" >&2; exit 1; }

# manifest.json and package.json must agree, or the store listing and the
# repository disagree about what shipped.
pkg_version="$(git show "$ref:package.json" | sed -n 's/.*"version": "\([^"]*\)".*/\1/p' | head -1)"
[ "$version" = "$pkg_version" ] || {
  echo "version mismatch: manifest $version vs package.json $pkg_version" >&2; exit 1; }

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
git archive --format=tar "$ref" | tar -x -C "$stage"

# The runtime file list. zip.js is REQUIRED: popup.html loads it, and popup.js
# guards on `typeof buildStoreZip === 'function'`, so omitting it disables the
# archive feature silently instead of failing loudly.
files=(manifest.json content.js popup.js popup.html zip.js icons)
for f in "${files[@]}"; do
  [ -e "$stage/$f" ] || { echo "missing from $ref: $f" >&2; exit 1; }
done

# Every file the manifest and popup reference must be present, checked here
# rather than discovered by a user whose button does nothing.
( cd "$stage" && node -e '
  const fs=require("fs");
  const m=JSON.parse(fs.readFileSync("manifest.json","utf8"));
  const want=[...Object.values(m.icons||{}),
              ...Object.values((m.action||{}).default_icon||{}),
              ...(m.content_scripts||[]).flatMap(c=>c.js||[]),
              (m.action||{}).default_popup].filter(Boolean);
  const html=fs.readFileSync("popup.html","utf8");
  for (const s of [...html.matchAll(/src="([^"]+)"/g)].map(x=>x[1])) want.push(s);
  const missing=want.filter(p=>!fs.existsSync(p));
  if (missing.length) { console.error("referenced but not packaged: "+missing.join(", ")); process.exit(1); }
'
)

out="$PWD/dist"
mkdir -p "$out"
zip_path="$out/conversation-to-markdown-v$version.zip"
rm -f "$zip_path"
# -X drops extra file attributes so the archive is reproducible across machines.
( cd "$stage" && zip -rqX "$zip_path" "${files[@]}" -x '.*' -x '__MACOSX/*' )
( cd "$out" && shasum -a 256 "$(basename "$zip_path")" > "$(basename "$zip_path").sha256" )

echo "built $zip_path"
unzip -l "$zip_path"
cat "$zip_path.sha256"
