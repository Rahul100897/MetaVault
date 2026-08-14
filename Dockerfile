# MetaVault production image.
# Both Railway services build from this file (see railway.json /
# railway.worker.json). The web service runs `docker-start` (prisma migrate
# deploy + serve); the worker overrides the command to `npm run worker`.
FROM node:20-alpine
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
