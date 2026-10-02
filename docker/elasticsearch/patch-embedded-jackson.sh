#!/bin/sh
set -eu
jar=/usr/share/elasticsearch/jdk/bin/jar
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/core"
(cd "$work/core" && "$jar" xf /tmp/jackson-core.jar)
# Preserve Elastic's archive manifests, module descriptors and implementation paths.
for target in \
  /usr/share/elasticsearch/lib/elasticsearch-x-content-8.19.21.jar \
  /usr/share/elasticsearch/lib/tools/plugin-cli/elasticsearch-x-content-8.19.21.jar \
  /usr/share/elasticsearch/bin/elasticsearch-sql-cli-8.19.21.jar; do
  "$jar" tf "$target" > "$work/entries"
  if grep -Eq '^META-INF/[^/]+\.(SF|RSA|DSA|EC)$' "$work/entries"; then
    echo 'Refusing to rewrite a signed archive' >&2; exit 1
  fi
  mkdir "$work/archive"
  (cd "$work/archive" && "$jar" xf "$target")
  case "$target" in
    */elasticsearch-x-content-*)
      prefix="$work/archive/IMPL-JARS/x-content/jackson-core-2.18.9.jar"
      test -f "$prefix/com/fasterxml/jackson/core/JsonFactory.class"
      rm -rf "$prefix"
      mkdir "$prefix"
      cp -R "$work/core/." "$prefix/"
      ;;
    */elasticsearch-sql-cli-*)
      test -f "$work/archive/com/fasterxml/jackson/core/JsonFactory.class"
      rm -rf "$work/archive/com/fasterxml/jackson/core" \
        "$work/archive/META-INF/maven/com.fasterxml.jackson.core/jackson-core"
      cp -R "$work/core/com/fasterxml/jackson/core" "$work/archive/com/fasterxml/jackson/"
      cp -R "$work/core/META-INF/maven/com.fasterxml.jackson.core/jackson-core" \
        "$work/archive/META-INF/maven/com.fasterxml.jackson.core/"
      for version in "$work/archive"/META-INF/versions/*; do
        test ! -d "$version" || rm -rf "$version/com/fasterxml/jackson/core"
      done
      for version in "$work/core"/META-INF/versions/*; do
        test -d "$version/com/fasterxml/jackson/core" || continue
        destination="$work/archive/META-INF/versions/$(basename "$version")/com/fasterxml/jackson"
        mkdir -p "$destination"
        cp -R "$version/com/fasterxml/jackson/core" "$destination/"
      done
      ;;
  esac
  "$jar" --create --no-manifest --file "$work/rebuilt.jar" -C "$work/archive" .
  install -m 0644 -o 1000 -g 0 "$work/rebuilt.jar" "$target"
  rm -rf "$work/archive" "$work/rebuilt.jar"
done
