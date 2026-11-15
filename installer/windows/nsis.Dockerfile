# makensis for building the Windows installer where a native makensis is unavailable or broken
# (the macOS 27 build crashes with std::bad_alloc). Used by scripts/build-installer.mjs.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends nsis && rm -rf /var/lib/apt/lists/*
WORKDIR /work
ENTRYPOINT ["makensis"]
