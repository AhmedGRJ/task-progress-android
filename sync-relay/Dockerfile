FROM node:22-alpine
WORKDIR /app
COPY sync-relay.js .
VOLUME /data
EXPOSE 8083
CMD ["node", "sync-relay.js", "--port", "8083", "--data", "/data"]
