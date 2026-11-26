FROM postgres:16.16-alpine3.24@sha256:f2f98726820d0342055351c6e9d36e705f5bfffb3dd53ff556325114b08afb6d AS hardened

# Preserve the upstream root entrypoint's volume ownership repair while replacing
# the Go-based gosu helper with Alpine's small native su-exec equivalent.
RUN apk upgrade --no-cache \
    && apk add --no-cache su-exec \
    && cp /sbin/su-exec /usr/local/bin/gosu

# Flatten the sanitized filesystem so scanners do not retain the replaced Go
# binary from an inaccessible parent layer.
FROM scratch
COPY --from=hardened / /

ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    LANG=en_US.utf8 \
    PG_MAJOR=16 \
    PG_VERSION=16.16 \
    PGDATA=/var/lib/postgresql/data

VOLUME ["/var/lib/postgresql/data"]
EXPOSE 5432
STOPSIGNAL SIGINT
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["postgres"]

USER postgres
