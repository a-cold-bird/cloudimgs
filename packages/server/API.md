# CloudImgs API 文档

**Base URL**: `http://localhost:3003/api`

## 🔐 认证 (Authentication)

除 `Public` 和 `Serve` 模块外，其他管理接口需要在 Header 中携带密码：

- **Header**: `x-access-password: <your-password>`
- **Query Param** (可选): `?password=<your-password>`

---

## 🌍 公开接口 (Public API) `无需认证`

用于公共展示、博客引用、表情包调用等场景。

### 1. 获取公开相册列表
- **GET** `/public/albums`
- **响应**:
  ```json
  {
    "success": true,
    "data": [
      { "id": "uuid", "name": "Emoji", "slug": "emoji", "path": "/emoji", "coverFileId": "..." }
    ]
  }
  ```

### 2. 获取相册详情及文件
- **GET** `/public/albums/:slug`
- **响应**:
  ```json
  {
    "success": true,
    "data": {
      "album": { ... },
      "files": [
        { "id": "...", "url": "/api/serve/...", "thumbhash": "...", "tags": ["funny"] }
      ]
    }
  }
  ```

### 3. 分页获取文件
- **GET** `/public/albums/:slug/files`
- **Query**: `?page=1&limit=50&tag=funny`
- **响应**: 含分页信息的图片列表。

### 4. 随机图片 (Random Image)
- **GET** `/public/random`
  - **Query**:
    - `tag`: (可选) 按标签筛选，如 `funny`
    - `redirect`: `true` (默认-跳转图片) / `false` (返回JSON)
- **GET** `/public/albums/:slug/random`
  - **Query**: 同上

---

## 🖼️ 图片服务 (Image Serving) `无需认证`

### 1. 图片预览与处理
- **GET** `/serve/:key`
- **参数**:
  - `w`: 宽度 (px)
  - `h`: 高度 (px)
  - `q`: 质量 (1-100)
  - `fmt`: 格式 (`webp`, `jpg`, `png`, `avif`)
- **示例**: 
  - `/api/serve/2024/01/abc.jpg?w=200&h=200&fmt=webp` (生成 200x200 的 WebP 缩略图)

---

## 🏷️ 标签管理 (Tags) `需认证`

### 1. 获取所有标签
- **GET** `/tags`

### 2. 创建标签
- **POST** `/tags`
- **Body**: `{ "name": "Funny", "color": "#ff0000" }`

### 3. 给文件添加/移除标签
- **POST** `/tags/files/:id/add`
  - **Body**: `{ "tag": "funny" }`
- **POST** `/tags/files/:id/remove`
  - **Body**: `{ "tag": "funny" }`

### 4. 更新文件所有标签
- **PATCH** `/tags/files/:id`
  - **Body**: `{ "tags": ["funny", "cat"] }`

---

## 📁 文件管理 (Files) `需认证`

### 1. 文件列表
- **GET** `/files`
- **Query**:
  - `page`: 页码
  - `limit`: 每页数量
  - `albumId`: (可选) 筛选相册
  - `search`: (可选) 搜索文件名

### 2. 上传文件
- **POST** `/files/upload`
- **Content-Type**: `multipart/form-data`
- **Body**:
  - `file`: (文件二进制)
  - `albumId`: (可选) 目标相册 ID

### 3. Base64 上传
- **POST** `/files/upload-base64`
- **Body**: `{ "image": "data:image/png;base64,...", "albumId": "..." }`

### 4. 批量操作
- **POST** `/files/batch/delete`
  - **Body**: `{ "ids": ["uuid1", "uuid2"] }`
- **POST** `/files/batch/move`
  - **Body**: `{ "ids": ["uuid1"], "albumId": "target-uuid" }`

---

## 📂 相册管理 (Albums) `需认证`

### 1. 获取相册树
- **GET** `/albums`
- **Query**:
  - `flat`: `true` (返回扁平列表) / `false` (返回根节点，需递归查询)
  - `parentId`: (可选) 获取子相册

### 2. 创建相册
- **POST** `/albums`
- **Body**:
  ```json
  {
    "name": "My Album",
    "parentId": "uuid",    // 可选
    "isPublic": true,      // 是否公开
    "password": "123"      // 可选访问密码
  }
  ```

### 3. 更新相册
- **PATCH** `/albums/:id`
- **Body**: `{ "name": "New Name", "isPublic": false }`

### 4. 删除相册
- **DELETE** `/albums/:id`

---

## 🗺️ 地图模式 (Map) `部分公开`

### 1. 获取带 GPS 的照片
- **GET** `/map/photos`
- **响应**:
  ```json
  [
    { "id": "...", "lat": 35.6895, "lng": 139.6917, "thumbUrl": "..." }
  ]
  ```

---

## 💾 数据库 Schema (TypeScript 引用)

```typescript
interface File {
  id: string;
  originalName: string;
  size: number;
  mimeType: string;
  width?: number;
  height?: number;
  thumbhash?: string;
  tags: string[]; // JSON array
  albumId?: string;
  createdAt: string;
  url: string; // 只有在响应中才会动态生成完整 URL
}

interface Album {
  id: string;
  name: string;
  slug: string;
  isPublic: boolean;
  parentId?: string;
  children?: Album[];
  fileCount?: number;
}
```
