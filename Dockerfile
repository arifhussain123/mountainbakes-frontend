# Next.js web app for Cloud Run.
#
# Debian slim rather than Alpine: glibc matches the prebuilt native binaries npm
# serves (unrs-resolver, esbuild), so nothing rebuilds from source at install time.
# Note `sharp` is NOT installed and is not needed — verified by requesting
# /_next/image against the standalone server, which optimised a 45KB PNG down to
# 2.7KB with no sharp present. The `allowBuilds: sharp` entry in pnpm-workspace.yaml
# is vestigial.
#
# NEXT_PUBLIC_* values are inlined into the browser bundle by `next build`, so every
# one the app reads has to be present in the BUILDER stage — setting them at runtime
# on Cloud Run does nothing. They are defaulted as ENV rather than left to --build-arg
# so `gcloud run deploy --source .` works without extra plumbing (Cloud Build's
# --source path has no --build-arg). All four are public by definition: they are
# already served inside the JS bundle, so the image is not the thing exposing them.
# Override any of them per-build with --build-arg.

# ---- deps: install once, cached on lockfile changes only -------------------------
FROM node:24-slim AS deps
WORKDIR /app
RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---- builder --------------------------------------------------------------------
FROM node:24-slim AS builder
WORKDIR /app
RUN corepack enable pnpm
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_API_URL=https://mountainproject-c84e8ec5e300.herokuapp.com
ARG NEXT_PUBLIC_WEB_URL=https://mountainbakes-2f685.web.app
ARG NEXT_PUBLIC_SUPABASE_URL=https://wzjabtuoxrvyareptddq.supabase.co
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_PCx8HWA_l9H0L19Y2HAU_Q_hKQaxN1B
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_WEB_URL=$NEXT_PUBLIC_WEB_URL \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NODE_ENV=production

RUN pnpm build

# ---- runner ---------------------------------------------------------------------
FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    # Cloud Run injects PORT; standalone server.js reads it. HOSTNAME must be
    # 0.0.0.0 or the server binds loopback and Cloud Run's health check fails.
    PORT=8080 \
    HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# Three separate copies: standalone carries server.js + traced node_modules, but
# next build deliberately leaves static assets and public/ out of it.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 8080
CMD ["node", "server.js"]
