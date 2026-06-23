# Production multi-stage build.
# Stage 1 compiles the React frontend; Stage 2 runs the Node.js backend
# which serves the compiled assets as static files on port 9090.

# --- Stage 1: Build frontend ---
FROM registry.access.redhat.com/ubi9/nodejs-20:latest AS frontend-build
USER root
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- Stage 2: Backend runtime ---
FROM registry.access.redhat.com/ubi9/nodejs-20:latest
USER root
WORKDIR /app

COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY backend/src/ ./src/
COPY data/ ./data/
COPY --from=frontend-build /build/dist ./public

RUN mkdir -p /var/lib/dcm-site-ui/data && \
    chown -R 1001:0 /var/lib/dcm-site-ui/data /app

USER 1001

EXPOSE 9090

ENV NODE_ENV=production \
    PORT=9090 \
    DATA_DIR=/var/lib/dcm-site-ui/data

VOLUME ["/var/lib/dcm-site-ui/data"]

CMD ["node", "src/index.js"]
