# MetaVault production image.
# Railway uses nixpacks (see railway.json); this Dockerfile is kept correct as a
# fallback / for local container builds. The web service runs `docker-start`
# (prisma migrate deploy + serve); override the command to `npm run worker` for
# the worker service.
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
