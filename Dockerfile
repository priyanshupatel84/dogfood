FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile=false
COPY . .
RUN pnpm build
EXPOSE 3000
CMD ["sh", "-c", "pnpm db:migrate && pnpm seed && pnpm start"]
