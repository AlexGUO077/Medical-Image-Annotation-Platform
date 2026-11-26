FROM docker.elastic.co/elasticsearch/elasticsearch-wolfi:8.19.26@sha256:1c58031eac1f9482d670fb0766c166f723eca098f1394477e63d2b9428ad6ace

USER root

# Each module has its own classloader. Preserve the bundled JAR paths when upgrading.
ADD --checksum=sha256:b530942257fb935f8b2cfaa5f8eb5bd59c555fd8e8d01b8ce98912e077ea606c https://repo.maven.apache.org/maven2/com/google/guava/guava/33.7.2-jre/guava-33.7.2-jre.jar /tmp/guava.jar
ADD --checksum=sha256:cbfc3906b19b8f55dd7cfd6dfe0aa4532e834250d7f080bd8d211a3e246b59cb https://repo.maven.apache.org/maven2/com/google/guava/failureaccess/1.0.3/failureaccess-1.0.3.jar /tmp/failureaccess.jar
WORKDIR /usr/share/elasticsearch
RUN test "$(find modules -name 'guava-*.jar' | wc -l)" -eq 5 \
    && test "$(find modules -name 'failureaccess-*.jar' | wc -l)" -eq 4 \
    && for module in repository-gcs x-pack-identity-provider x-pack-inference x-pack-security x-pack-watcher; do \
         path="modules/${module}/guava-32.0.1-jre.jar"; \
         test -f "$path" && install -m 0644 -o 1000 -g 0 /tmp/guava.jar "$path" || exit 1; \
         if [ "$module" = x-pack-inference ]; then \
           path="modules/${module}/failureaccess-1.0.3.jar"; \
         else \
           path="modules/${module}/failureaccess-1.0.1.jar"; \
           test -f "$path" || exit 1; \
         fi; \
         install -m 0644 -o 1000 -g 0 /tmp/failureaccess.jar "$path" || exit 1; \
       done \
    && rm /tmp/guava.jar /tmp/failureaccess.jar

USER 1000:0
