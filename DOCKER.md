# CloudImgs Docker 部署指南

## 快速开始

### 方式一：本地构建（推荐）

1. 创建 `docker-compose.yml` 文件：

```yaml
services:
  cloudimgs:
    build: .
    ports:
      - "3003:3003"
    volumes:
      - ./uploads:/app/uploads:rw
      - ./data:/app/data:rw
      - ./logs:/app/logs:rw
    restart: unless-stopped
    container_name: cloudimgs-app
    environment:
      - PUID=1000
      - PGID=1000
      - NODE_ENV=production
      - PORT=3003
      - STORAGE_PATH=/app/uploads
      - DATABASE_URL=/app/data/cloudimgs.db
```

2. 启动服务：

```bash
docker compose up -d --build
```

3. 访问 `http://localhost:3003`

### 方式二：克隆后构建（等同方式一）

1. 克隆仓库：

```bash
git clone https://github.com/a-cold-bird/cloudimgs.git
cd cloudimgs
```

2. 构建并启动：

```bash
docker compose up -d --build
```

## 数据持久化

所有数据都存储在 `uploads` 目录中：

```
uploads/
├── .cache/              # 缓存目录
│   ├── img_metadata.json  # 地图元数据缓存
│   └── *.th              # ThumbHash 缓存文件
├── albums/              # 相册目录
│   └── <album-slug>/    # 各相册的图片
└── *.jpg, *.png...      # 根目录图片
```

**重要**: 只需挂载 `uploads` 目录即可保留所有数据，包括：
- 上传的图片
- 相册结构
- 缩略图缓存
- 地图元数据

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | 3003 | 服务端口 |
| `STORAGE_PATH` | /app/uploads | 存储路径 |
| `DATABASE_URL` | /app/data/cloudimgs.db | SQLite 数据库路径 |
| `PASSWORD` | - | 访问密码（可选） |
| `PUID` | 1000 | 运行用户 ID |
| `PGID` | 1000 | 运行用户组 ID |
| `UMASK` | 002 | 文件权限掩码 |
| `NODE_ENV` | production | 运行环境 |

## 常用命令

```bash
# 启动服务
docker compose up -d --build

# 查看日志
docker compose logs -f

# 停止服务
docker compose down

# 重新构建并启动
docker compose up -d --build

# 本仓库无预构建镜像：更新代码后重新构建
# docker compose up -d --build
```

## NAS 部署

### 群晖 Synology

1. 安装 Container Manager
2. 在 `docker` 共享文件夹下创建 `cloudimgs` 目录
3. 上传 `docker-compose.yml`
4. 修改 PUID/PGID 为您的用户 ID：
   ```bash
   # SSH 登录后执行
   id -u  # 获取 UID
   id -g  # 获取 GID
   ```
5. 在 Container Manager 中创建项目

### 威联通 QNAP

1. 安装 Container Station
2. 创建项目并粘贴 docker-compose.yml 内容
3. 配置存储卷映射

## 备份与恢复

### 备份

```bash
# 备份 uploads 目录
tar -czvf cloudimgs-backup-$(date +%Y%m%d).tar.gz uploads/
```

### 恢复

```bash
# 停止服务
docker compose down

# 恢复数据
tar -xzvf cloudimgs-backup-YYYYMMDD.tar.gz

# 启动服务
docker compose up -d
```

## 故障排除

### 权限问题

如果遇到权限错误，检查 PUID/PGID 是否正确：

```bash
# 查看当前用户 ID
id

# 修改目录权限
sudo chown -R 1000:1000 uploads/
```

### 端口冲突

修改 docker-compose.yml 中的端口映射：

```yaml
ports:
  - "8080:3003"  # 改为 8080 端口
```

### 查看容器日志

```bash
docker compose logs -f cloudimgs
```
