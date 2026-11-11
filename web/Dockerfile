# ---------- Stage 1: build the React app ----------
FROM node:22-alpine AS build
WORKDIR /app

# Supabase URL + anon key are baked into the static files at build time.
# Both are public by design (protected by row-level security); never pass the service_role key.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_ENABLE_PHONE_AUTH=false
ARG APP_VERSION=dev
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_ENABLE_PHONE_AUTH=$VITE_ENABLE_PHONE_AUTH

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && printf '{"status":"ok","version":"%s"}\n' "$APP_VERSION" > dist/health.json

# ---------- Stage 2: serve with unprivileged nginx ----------
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
USER 101
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1
