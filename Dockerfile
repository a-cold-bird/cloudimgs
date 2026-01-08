# 多阶段构建 - 构建阶段
FROM node:18-alpine AS builder

# 设置工作目录
WORKDIR /app

# 安装构建工具和依赖
RUN apk add --no-cache git python3 make g++

# 设置Node.js内存限制（避免OOM）
ENV NODE_OPTIONS="--max-old-space-size=4096"
# 禁用 Source Map 以减少内存占用和加快构建速度
ENV GENERATE_SOURCEMAP=false

# 设置npm配置
ENV NPM_CONFIG_AUDIT=false
ENV NPM_CONFIG_FUND=false
ENV NPM_CONFIG_PROGRESS=false
ENV NPM_CONFIG_LOGLEVEL=warn

# 复制package.json文件
COPY package*.json ./

# 安装所有依赖（包括开发依赖，用于构建）
RUN npm install --no-audit --no-fund --prefer-offline --verbose --legacy-peer-deps

# 复制客户端package.json (Vue客户端)
COPY client-vue/package*.json ./client-vue/

# 安装客户端依赖
RUN cd client-vue && \
    echo "=== Installing Vue client dependencies ===" && \
    npm install --no-audit --no-fund --prefer-offline --verbose --legacy-peer-deps && \
    echo "=== Vue client dependencies installed successfully ==="

# 复制源代码
COPY . .

# 显示构建环境信息
RUN echo "=== Build Environment Info ===" && \
    node --version && \
    npm --version && \
    echo "=== Current Directory ===" && \
    pwd && \
    ls -la && \
    echo "=== Vue Client Directory ===" && \
    ls -la client-vue/

# 构建Vue客户端
RUN cd client-vue && \
    echo "=== Starting Vue client build ===" && \
    npm run build && \
    echo "=== Vue client build completed ==="

# 验证构建结果
RUN echo "=== Build Result ===" && \
    ls -la client-vue/dist/ && \
    echo "=== Build files count ===" && \
    find client-vue/dist -type f | wc -l && \
    echo "=== Build successful ==="

# 生产阶段
FROM node:18-alpine AS production

# 设置工作目录
WORKDIR /app

# 安装 su-exec 和基础依赖
RUN apk add --no-cache su-exec

# 从构建阶段复制node_modules和应用文件
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/server ./server
COPY --from=builder /app/config.js ./
COPY --from=builder /app/client-vue/dist ./client-vue/dist

# 创建上传目录
RUN mkdir -p uploads logs

# 验证文件复制
RUN echo "=== Production Image Verification ===" && \
    ls -la client-vue/dist/ && \
    echo "=== Node modules verification ===" && \
    ls -la node_modules/ | head -10

# 暴露端口
EXPOSE 3001

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=3001
ENV STORAGE_PATH=/app/uploads
ENV PUID=1000
ENV PGID=1000
ENV UMASK=002

# 复制入口脚本
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/stats', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# 使用入口脚本启动
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "start"]
