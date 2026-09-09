FROM node:22-alpine
WORKDIR /app
COPY package.json server.mjs ./
COPY public ./public
COPY data ./data
ENV NODE_ENV=production PORT=4180 DATA_DIR=/data COOKIE_SECURE=true
VOLUME ["/data"]
EXPOSE 4180
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:4180/ >/dev/null 2>&1 || exit 1
CMD ["node", "server.mjs"]
