FROM node:22-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
COPY apps/admin/package.json apps/admin/package.json
COPY apps/server/package.json apps/server/package.json
RUN npm ci
COPY apps ./apps
COPY prisma ./prisma
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS server
RUN apk add --no-cache openssl
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/prisma ./prisma
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --start-period=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3001/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && exec node dist/main.js"]

FROM nginxinc/nginx-unprivileged:stable-alpine AS admin
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
