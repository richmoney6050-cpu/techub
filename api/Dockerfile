FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY . .
ENV NODE_ENV=production PORT=4000 UPLOAD_DIR=/data/uploads BACKUP_DIR=/data/backups
VOLUME ["/data/uploads", "/data/backups"]
EXPOSE 4000
CMD ["npm", "start"]
