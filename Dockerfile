FROM node:22-alpine
ARG VCS_REF=development
WORKDIR /app
RUN apk add --no-cache su-exec
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs exports.mjs ./
COPY public ./public
COPY data ./data
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh
ENV NODE_ENV=production PORT=4180 DATA_DIR=/data COOKIE_SECURE=true APP_VERSION=${VCS_REF}
VOLUME ["/data"]
EXPOSE 4180
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:4180/api/health >/dev/null 2>&1 || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.mjs"]
