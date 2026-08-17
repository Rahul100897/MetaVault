# MetaVault production image.
# Both Railway services build from this file (see railway.json /
# railway.worker.json). The web service runs `docker-start` (prisma migrate
# deploy + serve); the worker overrides the command to `npm run worker`.
# Node 22: the AWS SDK v3 (used by r2.server.ts) drops Node 20 support in
# January 2027 and already warns on every S3 call. 22 is the current LTS.
FROM node:22-alpine
RUN apk add --no-cache openssl

EXPOSE 3000
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./

# Install ALL deps: the build needs vite/typescript, and the worker runs on tsx
# at runtime. (Kept unpruned so a single image can serve as web OR worker.)
RUN npm ci --include=dev && npm cache clean --force

COPY . .

RUN npm run build

CMD ["npm", "run", "docker-start"]
