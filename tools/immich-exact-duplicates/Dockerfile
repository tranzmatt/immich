FROM node:24-alpine
RUN apk add --no-cache b3sum
WORKDIR /app
COPY package.json server.mjs ./
COPY public ./public
USER node
EXPOSE 3210
CMD ["node", "server.mjs"]
