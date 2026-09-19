FROM docker.elastic.co/elasticsearch/elasticsearch-wolfi:8.19.21@sha256:4780b851ca7f79eb59c94d5151984c2748c7548c8074047c870a0b187eb918ea

USER root

ADD --checksum=sha256:f474b14c7734f15e0540394cb6f39d67777b7581a42919e4ac89d253d4efd929 https://repo.maven.apache.org/maven2/io/netty/netty-buffer/4.1.137.Final/netty-buffer-4.1.137.Final.jar /tmp/netty/netty-buffer-4.1.137.Final.jar
ADD --checksum=sha256:9987b6a660b0a6b1f0d791485dae33180b3d1c63687c006fe6d3fd025e9e3798 https://repo.maven.apache.org/maven2/io/netty/netty-codec/4.1.137.Final/netty-codec-4.1.137.Final.jar /tmp/netty/netty-codec-4.1.137.Final.jar
ADD --checksum=sha256:2d9a33ce41bd9f6f607df95039e42518a1fca16f83c9bbfe72beb57df6e2489f https://repo.maven.apache.org/maven2/io/netty/netty-codec-dns/4.1.137.Final/netty-codec-dns-4.1.137.Final.jar /tmp/netty/netty-codec-dns-4.1.137.Final.jar
ADD --checksum=sha256:0535bb5a736472bef5c948d15eb273c4ab9f796656fc7c5d6b982ad92bddbd49 https://repo.maven.apache.org/maven2/io/netty/netty-codec-http/4.1.137.Final/netty-codec-http-4.1.137.Final.jar /tmp/netty/netty-codec-http-4.1.137.Final.jar
ADD --checksum=sha256:576ddcfb51b78e86f145c9a52b60e500b1a1d5a257cafec8aa5416ffba044b49 https://repo.maven.apache.org/maven2/io/netty/netty-codec-http2/4.1.137.Final/netty-codec-http2-4.1.137.Final.jar /tmp/netty/netty-codec-http2-4.1.137.Final.jar
ADD --checksum=sha256:4a6190e08988c058bfeef2b5965e71946439c771abf721c68f4039b4e7b023e8 https://repo.maven.apache.org/maven2/io/netty/netty-codec-socks/4.1.137.Final/netty-codec-socks-4.1.137.Final.jar /tmp/netty/netty-codec-socks-4.1.137.Final.jar
ADD --checksum=sha256:d31926b01adcc07af86f5e27b81b6d6c115df17d366e835d1fc3f5a1924e7e52 https://repo.maven.apache.org/maven2/io/netty/netty-common/4.1.137.Final/netty-common-4.1.137.Final.jar /tmp/netty/netty-common-4.1.137.Final.jar
ADD --checksum=sha256:d0e4c6ee4779f59f6ab2fb5d388e4f57147c82270164b37945764bb9bda96a44 https://repo.maven.apache.org/maven2/io/netty/netty-handler/4.1.137.Final/netty-handler-4.1.137.Final.jar /tmp/netty/netty-handler-4.1.137.Final.jar
ADD --checksum=sha256:843de10c4cef34cbc1a5344090f1b57db532fbebf141559862da675f6b656df4 https://repo.maven.apache.org/maven2/io/netty/netty-handler-proxy/4.1.137.Final/netty-handler-proxy-4.1.137.Final.jar /tmp/netty/netty-handler-proxy-4.1.137.Final.jar
ADD --checksum=sha256:b4cf2aeedd9fc7c8c439bbfe574f63cfe5b83392e88bbc07ca0e8424b7cff955 https://repo.maven.apache.org/maven2/io/netty/netty-resolver/4.1.137.Final/netty-resolver-4.1.137.Final.jar /tmp/netty/netty-resolver-4.1.137.Final.jar
ADD --checksum=sha256:898d63ca62ed68ff46543c5344f969424b417f1e8d082fe2bb0181ba10144194 https://repo.maven.apache.org/maven2/io/netty/netty-resolver-dns/4.1.137.Final/netty-resolver-dns-4.1.137.Final.jar /tmp/netty/netty-resolver-dns-4.1.137.Final.jar
ADD --checksum=sha256:6251adc2a2921572382732a2db188d4f4f2251fd6ebb49c5d44bbf33d6bfb1a7 https://repo.maven.apache.org/maven2/io/netty/netty-transport/4.1.137.Final/netty-transport-4.1.137.Final.jar /tmp/netty/netty-transport-4.1.137.Final.jar
ADD --checksum=sha256:8056e7637f9948f953314894cf995ab664711b66c73c4cd5b593ae84f0b1048c https://repo.maven.apache.org/maven2/io/netty/netty-transport-native-unix-common/4.1.137.Final/netty-transport-native-unix-common-4.1.137.Final.jar /tmp/netty/netty-transport-native-unix-common-4.1.137.Final.jar
ADD --checksum=sha256:55049554b799dc8e53bf234fffa36e001f7b5b65c32994b9bd59fc6356f1c52f https://repo.maven.apache.org/maven2/io/netty/netty-transport-classes-epoll/4.1.137.Final/netty-transport-classes-epoll-4.1.137.Final.jar /tmp/netty/netty-transport-classes-epoll-4.1.137.Final.jar

RUN find /usr/share/elasticsearch/modules -type f -name '*-4.1.135.Final.jar' \
      -exec sh -c 'for old do artifact="$(basename "$old" -4.1.135.Final.jar)"; install -m 0644 -o 1000 -g 0 "/tmp/netty/${artifact}-4.1.137.Final.jar" "$old"; done' sh {} + \
    && rm -rf /tmp/netty

USER 1000:0
