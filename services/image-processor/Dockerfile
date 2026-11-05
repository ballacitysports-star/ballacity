# BallaCity image processor (design/PoC, NOT built or deployed). Build from the repository root:
#   docker build -f services/image-processor/Dockerfile -t ballacity-image-processor .
# Run with a read-only root filesystem, no capabilities and no outbound network, e.g.:
#   docker run --read-only --tmpfs /tmp:size=16m,mode=1777 --cap-drop=ALL --security-opt=no-new-privileges \
#     --memory=1g --cpus=2 --pids-limit=64 --network=<internal-only network> \
#     -e IMAGE_PROCESSOR_SECRET=<from the secret manager> -p 8080:8080 ballacity-image-processor
#
# BEFORE USE: replace both digest placeholders with the current digests of these exact tags (docker buildx imagetools inspect
# <image>:<tag>), and keep them pinned; update deliberately. A placeholder digest fails the build on purpose.

# --- build: install the pinned lockfile (sharp + its prebuilt libvips for linux-x64/glibc) and bundle the service -------------
FROM node:22.23.4-bookworm-slim@sha256:REPLACE_WITH_PINNED_DIGEST_OF_node_22.23.4-bookworm-slim AS build
WORKDIR /build
COPY services/image-processor/package.json services/image-processor/package-lock.json services/image-processor/
RUN cd services/image-processor && npm ci --no-audit --no-fund
# Only the modules the service imports, plus the tsconfig for the "@/" path alias.
COPY tsconfig.json ./
COPY src/lib/image-reencode.server.ts src/lib/image-metadata.ts src/lib/image-validation.ts src/lib/
COPY src/lib/image-runtime/hmac.ts src/lib/image-runtime/processor-protocol.ts src/lib/image-runtime/
COPY services/image-processor/src services/image-processor/src
RUN cd services/image-processor && npm run build && npm prune --omit=dev

# --- runtime: distroless Node (no shell, no package manager), non-root ---------------------------------------------------------
FROM gcr.io/distroless/nodejs22-debian12:nonroot@sha256:REPLACE_WITH_PINNED_DIGEST_OF_distroless_nodejs22-debian12_nonroot
WORKDIR /app
COPY --from=build --chown=65532:65532 /build/services/image-processor/node_modules ./node_modules
COPY --from=build --chown=65532:65532 /build/services/image-processor/dist/main.mjs ./main.mjs
USER 65532:65532
ENV NODE_ENV=production \
    PORT=8080 \
    UV_THREADPOOL_SIZE=2 \
    VIPS_CONCURRENCY=1 \
    NODE_OPTIONS=--max-old-space-size=256
EXPOSE 8080
# The distroless entrypoint is node itself.
CMD ["main.mjs"]
