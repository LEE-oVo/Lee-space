# ---- 构建阶段 ----
FROM node:16-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund --registry=https://registry.npmmirror.com
COPY . .
RUN npm run build

# ---- 输出阶段：运行时将产物同步到共享卷（命名卷非空时不会自动更新，需显式复制） ----
FROM alpine:3.19
COPY --from=build /app/dist /src-dist
CMD ["sh", "-c", "rm -rf /output/* && cp -r /src-dist/. /output/ && echo 'frontend assets deployed'"]
