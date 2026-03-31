# =============================================================================
# Production multi-stage build — build from source
#
# Build context: repository root (docker compose context: .)
#
# Build stages:
#   1. grpc-web-builder  – generate gRPC-web TypeScript proto stubs
#   2. ui-builder        – compile React/TypeScript UI  →  ui/build/
#   3. builder           – compile Rust source (embeds ui/build/ via rust-embed)
#   4. runtime           – minimal Debian slim image with the chirpstack binary
# =============================================================================

# Source root inside the build context (always . when context is the repo root)
ARG CHIRPSTACK_SRC=.

# =============================================================================
# Stage 1 – gRPC-web TypeScript proto file generation
#   Uses node:22 (Debian/glibc) because protoc-gen-grpc-web is a glibc binary.
#   grpc-tools v1.13+ no longer ships protoc-gen-grpc-web, so we download it
#   from the official grpc-web GitHub releases.
# =============================================================================
FROM node:22 AS grpc-web-builder

ARG CHIRPSTACK_SRC

RUN apt-get update && apt-get install -y --no-install-recommends make curl && \
    rm -rf /var/lib/apt/lists/*

RUN curl -sSL -o /usr/local/bin/protoc-gen-grpc-web \
      https://github.com/grpc/grpc-web/releases/download/1.5.0/protoc-gen-grpc-web-1.5.0-linux-x86_64 && \
    chmod +x /usr/local/bin/protoc-gen-grpc-web

WORKDIR /app
COPY ${CHIRPSTACK_SRC}/api/ api/

WORKDIR /app/api/grpc-web
RUN npm install -g pnpm && pnpm install && \
    PATH="$(pwd)/node_modules/grpc-tools/bin:$PATH" make all

# =============================================================================
# Stage 2 – React/TypeScript UI build
#   rust-embed embeds the output of this stage at Rust compile time
#   (folder = "../ui/build" relative to the chirpstack/ crate)
# =============================================================================
FROM node:22-alpine AS ui-builder

ARG CHIRPSTACK_SRC

RUN npm install -g pnpm

WORKDIR /app
COPY ${CHIRPSTACK_SRC}/ui/  ui/
COPY ${CHIRPSTACK_SRC}/api/ api/
COPY --from=grpc-web-builder /app/api/grpc-web/ api/grpc-web/

WORKDIR /app/ui
RUN pnpm install && pnpm build

# =============================================================================
# Stage 3 – Rust build
#   Uses rust:1 (Debian/glibc) — musl (Alpine) blocks proc-macro crates
#   which require dynamic linking support.
# =============================================================================
FROM rust:1 AS builder

ARG CHIRPSTACK_SRC

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    clang \
    libclang-dev \
    llvm-dev \
    libssl-dev \
    pkg-config \
    protobuf-compiler \
    libprotobuf-dev \
    zlib1g-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /build

COPY ${CHIRPSTACK_SRC}/ .

# Copy compiled UI assets (rust-embed looks for ../ui/build from the chirpstack/ crate)
COPY --from=ui-builder /app/ui/build ui/build

# bindgen (rquickjs) needs libclang — locate dynamically since LLVM version varies
RUN export LIBCLANG_PATH="$(find /usr/lib -name 'libclang*.so*' 2>/dev/null \
        | head -1 | xargs -I{} dirname {})" && \
    cargo build --release --no-default-features --features=postgres -p chirpstack

# =============================================================================
# Stage 4 – Minimal runtime image
# =============================================================================
FROM debian:trixie-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/target/release/chirpstack /usr/bin/chirpstack

USER nobody:nogroup
ENTRYPOINT ["/usr/bin/chirpstack"]
