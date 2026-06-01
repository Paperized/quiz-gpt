FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY frontend/package*.json frontend/
COPY backend/package*.json backend/
RUN npm install
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --chown=node:node package*.json ./
COPY --chown=node:node backend/package*.json backend/
RUN npm install --omit=dev --workspace backend
COPY --chown=node:node --from=build /app/backend/dist backend/dist
COPY --chown=node:node --from=build /app/backend/public backend/public
COPY --chown=node:node --from=build /app/backend/migrations backend/migrations
EXPOSE 3000
USER node
CMD ["npm", "run", "start", "--workspace", "backend"]
