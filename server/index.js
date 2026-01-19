require("dotenv").config();

const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs-extra");
const { v4: uuidv4 } = require("uuid");
const config = require("../config");
const sharp = require("sharp");
const mime = require("mime-types");
const mm = require("music-metadata");
const exifr = require("exifr");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");

const CACHE_DIR_NAME = ".cache";
const TRASH_DIR_NAME = ".trash";
const CONFIG_DIR_NAME = "config";
const ALBUM_PASSWORD_FILE = "album_password.json";

const app = express();
const PORT = config.server.port;

// ...

// Helper to get album password path
function getAlbumPasswordPath(dirPath) {
    const absDir = safeJoin(STORAGE_PATH, dirPath);
    return path.join(absDir, CONFIG_DIR_NAME, ALBUM_PASSWORD_FILE);
}

// Helper to check if album is locked
async function isAlbumLocked(dirPath) {
    try {
        const configPath = getAlbumPasswordPath(dirPath);
        if (await fs.pathExists(configPath)) {
            const data = await fs.readJson(configPath);
            return !!data.password;
        }
    } catch (e) {
        // 读取锁定状态失败，默认为未锁定
    }
    return false;
}

// Helper to verify album password
async function verifyAlbumPassword(dirPath, password) {
    try {
        const configPath = getAlbumPasswordPath(dirPath);
        if (await fs.pathExists(configPath)) {
            const data = await fs.readJson(configPath);
            // 空值检查：如果密码字段不存在或为空，验证失败
            if (!data.password) {
                return false;
            }
            // 支持 bcrypt 哈希密码和明文密码（向后兼容）
            if (data.password.startsWith('$2')) {
                // bcrypt 哈希格式
                return await bcrypt.compare(password, data.password);
            } else {
                // 明文密码（旧格式，向后兼容）
                const isValid = data.password === password;
                // 验证成功后自动升级为 bcrypt 哈希
                if (isValid) {
                    try {
                        const hashedPassword = await bcrypt.hash(password, 10);
                        await fs.writeJSON(configPath, { password: hashedPassword });
                        console.log(`[Security] Auto-upgraded plaintext password to bcrypt for: ${dirPath}`);
                    } catch (upgradeErr) {
                        console.error(`[Security] Failed to upgrade password for ${dirPath}:`, upgradeErr);
                        // 升级失败不影响验证结果
                    }
                }
                return isValid;
            }
        }
        // If no password file, it's not locked, so any password (or none) is fine
        // But logic usually calls this only if isAlbumLocked is true
        return true;
    } catch (e) {
        return false;
    }
}

// 中间件
// CORS 配置
const corsOptions = {
  origin: (origin, callback) => {
    // 如果未启用 CORS 白名单或允许所有来源
    if (!config.security.cors.enabled || config.security.cors.allowedOrigins.includes("*")) {
      callback(null, true);
      return;
    }
    // 允许没有 origin 的请求（如 Postman、curl 或同源请求）
    if (!origin) {
      callback(null, true);
      return;
    }
    // 检查是否在白名单中
    if (config.security.cors.allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("CORS 策略不允许此来源"));
    }
  },
  credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' })); // 增加限制以支持大型 base64 数据
app.use(express.static(path.join(__dirname, "../client-vue/dist")));
// 注意：express-rate-limit 会拒绝过于宽松的 trust proxy=true 设置（可被伪造 X-Forwarded-* 绕过限流）
// 默认关闭；如确实在反向代理后（如 Nginx/Caddy/Traefik），请设置环境变量 TRUST_PROXY=1（或具体 hop 数）
const TRUST_PROXY_RAW = process.env.TRUST_PROXY;
if (TRUST_PROXY_RAW == null || TRUST_PROXY_RAW === "") {
  app.set("trust proxy", false);
} else {
  const lowered = String(TRUST_PROXY_RAW).trim().toLowerCase();
  if (lowered === "false" || lowered === "0") {
    app.set("trust proxy", false);
  } else if (lowered === "true") {
    app.set("trust proxy", 1);
  } else if (/^\d+$/.test(lowered)) {
    app.set("trust proxy", Number.parseInt(lowered, 10));
  } else {
    // 允许使用 express 支持的值，例如：loopback / linklocal / uniquelocal
    app.set("trust proxy", TRUST_PROXY_RAW);
  }
}

// 速率限制配置 - 防止暴力破解和滥用
// 禁用 trust proxy 验证，因为我们已经在上面正确配置了 trust proxy
const rateLimitValidate = { trustProxy: false };

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 20, // 每个IP最多20次尝试
  message: { error: "登录尝试过多，请15分钟后再试" },
  standardHeaders: true,
  legacyHeaders: false,
  validate: rateLimitValidate,
});

const apiLimiter = rateLimit({
  windowMs: process.env.RATE_LIMIT_API_WINDOW_MS
    ? parseInt(process.env.RATE_LIMIT_API_WINDOW_MS, 10)
    : 1 * 60 * 1000, // 1分钟
  max: process.env.RATE_LIMIT_API_MAX
    ? parseInt(process.env.RATE_LIMIT_API_MAX, 10)
    : 1000, // 默认放宽：避免图片/列表请求触发 429 影响上传
  message: { error: "请求过于频繁，请稍后再试" },
  standardHeaders: true,
  legacyHeaders: false,
  validate: rateLimitValidate,
});

const uploadLimiter = rateLimit({
  windowMs: process.env.RATE_LIMIT_UPLOAD_WINDOW_MS
    ? parseInt(process.env.RATE_LIMIT_UPLOAD_WINDOW_MS, 10)
    : 1 * 60 * 1000,
  max: process.env.RATE_LIMIT_UPLOAD_MAX
    ? parseInt(process.env.RATE_LIMIT_UPLOAD_MAX, 10)
    : 300,
  message: { error: "上传过于频繁，请稍后再试" },
  standardHeaders: true,
  legacyHeaders: false,
  validate: rateLimitValidate,
});

// 对认证端点应用严格的速率限制
app.use("/api/auth/verify", authLimiter);
app.use("/api/album/verify", authLimiter);

// 对一般 API 应用速率限制（不对静态图片下载限流，避免前端列表加载触发 429）
app.use("/api/", (req, res, next) => {
  if (req.method === "OPTIONS") return next();
  if (req.path.startsWith("/images/")) return next();
  return apiLimiter(req, res, next);
});

// 健康检查端点 - 用于容器化部署和负载均衡
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

function getProtocol(req) {
  const trustProxy = req.app.get("trust proxy");
  const proto = trustProxy ? (req.headers["x-forwarded-proto"] || req.protocol) : req.protocol;
  if (Array.isArray(proto)) return proto[0];
  return String(proto).split(",")[0].trim();
}
function getHost(req) {
  const trustProxy = req.app.get("trust proxy");
  return trustProxy ? (req.headers["x-forwarded-host"] || req.get("host")) : req.get("host");
}
function getBaseUrl(req) {
  return `${getProtocol(req)}://${getHost(req)}`;
}

// 配置存储路径
const STORAGE_PATH = config.storage.path;

// 确保存储目录存在
fs.ensureDirSync(STORAGE_PATH);

// 密码验证中间件
function requirePassword(req, res, next) {
  if (!config.security.password.enabled) {
    return next();
  }

  const password =
    req.headers["x-access-password"] || req.body.password || req.query.password;

  if (!password) {
    return res.status(401).json({ error: "需要提供访问密码" });
  }

  if (password !== config.security.password.accessPassword) {
    return res.status(401).json({ error: "密码错误" });
  }

  next();
}

// 路径安全校验，防止目录穿越
function safeJoin(base, target) {
  const targetPath = path.resolve(base, target || "");
  if (!targetPath.startsWith(path.resolve(base))) {
    throw new Error("非法目录路径");
  }
  return targetPath;
}

// 处理中文文件名，确保编码正确
function sanitizeFilename(filename) {
  try {
    // 如果文件名已经被编码，先解码
    if (filename.includes("%")) {
      filename = decodeURIComponent(filename);
    }
    // 处理可能的 Buffer 编码问题
    if (Buffer.isBuffer(filename)) {
      filename = filename.toString("utf8");
    }
    // 移除或替换不安全的字符，但保留中文字符
    if (config.storage.filename.sanitizeSpecialChars) {
      filename = filename.replace(
        /[<>:"/\\|?*]/g,
        config.storage.filename.specialCharReplacement
      );
    }
    return filename;
  } catch (error) {
    console.warn("文件名处理错误:", error);
    // 如果解码失败，使用原始文件名但清理不安全字符
    return filename.replace(
      /[<>:"/\\|?*]/g,
      config.storage.filename.specialCharReplacement
    );
  }
}

// 检查文件格式是否允许
function isAllowedFile(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  const isAllowedExt = config.upload.allowedExtensions.includes(ext);
  const isAllowedMime = config.upload.allowedMimeTypes.includes(file.mimetype);
  return isAllowedExt && isAllowedMime;
}

const FORBIDDEN_EXTENSIONS = [
  ".php",
  ".html",
  ".htm",
  ".js",
  ".mjs",
  ".ts",
  ".sh",
  ".bat",
  ".exe",
  ".dll",
  ".com",
  ".cgi",
  ".pl",
  ".py",
  ".jar",
  ".apk",
  ".msi",
];
const FORBIDDEN_MIME_PREFIXES = [
  "text/html",
  "application/x-httpd-php",
  "application/javascript",
  "text/javascript",
  "application/x-sh",
  "application/x-msdownload",
  "application/vnd.android.package-archive",
];
function isForbiddenFile(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (FORBIDDEN_EXTENSIONS.includes(ext)) return true;
  const mime = (file.mimetype || "").toLowerCase();
  if (FORBIDDEN_MIME_PREFIXES.some((m) => mime.startsWith(m))) return true;
  return false;
}
// 配置multer，支持多层目录和中文文件名
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // 优先使用query参数，因为multer处理时body可能还没有解析
    let dir = req.query.dir || req.body.dir || "";
    dir = dir.replace(/\\/g, "/"); // 兼容windows
    const dest = safeJoin(STORAGE_PATH, dir);
    // 使用同步方式确保目录存在
    try {
      // 始终创建目录，不再依赖配置项
      fs.ensureDirSync(dest);
      cb(null, dest);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    let originalName = file.originalname;

    // 关键：latin1转utf8，彻底解决中文乱码
    // 修复：如果包含非 Latin1 字符 (> 255)，说明已经是 UTF-8，不需要转换
    if (!/[^\u0000-\u00ff]/.test(originalName)) {
      try {
        originalName = Buffer.from(originalName, "latin1").toString("utf8");
      } catch (e) {
        // latin1 转 utf8 失败，保持原始文件名
      }
    }

    const sanitizedName = sanitizeFilename(originalName);
    const ext = path.extname(sanitizedName);
    const nameWithoutExt = path.basename(sanitizedName, ext);
    let finalName = sanitizedName;
    let counter = 1;

    let dir = req.query.dir || req.body.dir || "";
    dir = dir.replace(/\\/g, "/");
    const dest = safeJoin(STORAGE_PATH, dir);

    // 处理文件名冲突
    if (!config.upload.allowDuplicateNames) {
      while (fs.existsSync(path.join(dest, finalName))) {
        if (config.upload.duplicateStrategy === "timestamp") {
          finalName = `${nameWithoutExt}_${Date.now()}_${counter}${ext}`;
        } else if (config.upload.duplicateStrategy === "counter") {
          finalName = `${nameWithoutExt}_${counter}${ext}`;
        } else if (config.upload.duplicateStrategy === "overwrite") {
          break; // 直接覆盖
        }
        counter++;
      }
    }

    cb(null, finalName);
  },
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (isAllowedFile(file)) {
      return cb(null, true);
    } else {
      const allowedFormats = config.upload.allowedExtensions.join(", ");
      cb(new Error(`只支持以下图片格式: ${allowedFormats}`));
    }
  },
  limits: {
    fileSize: config.upload.maxFileSize,
  },
});

// 通用文件上传配置（支持任意文件类型）
const uploadAny = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (isForbiddenFile(file)) {
      return cb(new Error("不允许上传可执行或危险文件类型"));
    }
    cb(null, true);
  },
  limits: {
    fileSize: config.upload.maxFileSize,
  },
});

// ThumbHash Helpers
async function generateThumbHash(filePath) {
  try {
    const dir = path.dirname(filePath);
    const filename = path.basename(filePath);
    const cacheDir = path.join(dir, CACHE_DIR_NAME);
    const cacheFile = path.join(cacheDir, `${filename}.th`);

    // Ensure cache dir exists
    await fs.ensureDir(cacheDir);

    // Resize to 100x100 max, get raw RGBA
    const image = sharp(filePath).resize(100, 100, { fit: 'inside' });
    const { data, info } = await image
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    
    // Dynamic import for ESM module
    const { rgbaToThumbHash } = await import("thumbhash");
    const binaryHash = rgbaToThumbHash(info.width, info.height, data);
    await fs.writeFile(cacheFile, Buffer.from(binaryHash));
    return Buffer.from(binaryHash).toString('base64');
  } catch (err) {
    console.error(`Failed to generate thumbhash for ${filePath}:`, err);
    return null;
  }
}

async function getThumbHash(filePath) {
   try {
    const dir = path.dirname(filePath);
    const filename = path.basename(filePath);
    const cacheFile = path.join(dir, CACHE_DIR_NAME, `${filename}.th`);
    
    if (await fs.pathExists(cacheFile)) {
      const buffer = await fs.readFile(cacheFile);
      return buffer.toString('base64');
    }
    return null;
   } catch (err) {
     return null;
   }
}

async function deleteThumbHash(filePath) {
    try {
        const dir = path.dirname(filePath);
        const filename = path.basename(filePath);
        const cacheFile = path.join(dir, CACHE_DIR_NAME, `${filename}.th`);
        if (await fs.pathExists(cacheFile)) {
            await fs.remove(cacheFile);
        }
    } catch (e) {
        // 删除缓存文件失败，忽略此错误
    }
}

async function moveThumbHash(oldPath, newPath) {
    try {
        const oldDir = path.dirname(oldPath);
        const oldName = path.basename(oldPath);
        const oldCache = path.join(oldDir, CACHE_DIR_NAME, `${oldName}.th`);
        
        if (await fs.pathExists(oldCache)) {
             const newDir = path.dirname(newPath);
             const newName = path.basename(newPath);
             const newCacheDir = path.join(newDir, CACHE_DIR_NAME);
             await fs.ensureDir(newCacheDir);
             const newCache = path.join(newCacheDir, `${newName}.th`);
             await fs.rename(oldCache, newCache);
        }
    } catch (e) {
        // 移动缩略图缓存失败，忽略此错误
    }
}

// 递归获取图片文件
async function getAllImages(dir = "", authPassword = null, rootPassword = null) {
  const absDir = safeJoin(STORAGE_PATH, dir);

  // 使用根密码或当前密码
  const effectiveRootPassword = rootPassword || authPassword;

  // Check if current directory is locked
  if (await isAlbumLocked(dir)) {
      // If locked, verify password
      if (!authPassword || !(await verifyAlbumPassword(dir, authPassword))) {
          return []; // Skip if locked and no valid password
      }
  }

  let results = [];
  try {
      const files = await fs.readdir(absDir);
      for (const file of files) {
        if (file === CACHE_DIR_NAME || file === CONFIG_DIR_NAME || file === TRASH_DIR_NAME) continue;
        const filePath = path.join(absDir, file);
        const relPath = path.join(dir, file);
        const stats = await fs.stat(filePath);
        if (stats.isDirectory()) {
          // 递归调用时传递根密码，允许子目录继承访问权限
          results = results.concat(await getAllImages(relPath, effectiveRootPassword, effectiveRootPassword));
        } else {
          const ext = path.extname(file).toLowerCase();
          if (config.upload.allowedExtensions.includes(ext)) {
            const safeFilename = sanitizeFilename(file);
            results.push({
              filename: safeFilename,
              relPath: relPath.replace(/\\/g, "/"),
              size: stats.size,
              uploadTime: stats.mtime.toISOString(),
              url: `/api/images/${relPath.replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/")}`,
            });
          }
        }
      }
  } catch (e) {
      // ignore error (e.g. dir not found)
  }
  return results;
}

// Map Cache Configuration
const MAP_CACHE_PATH = path.join(STORAGE_PATH, CACHE_DIR_NAME, "img_metadata.json");

async function updateMapCache() {
  await fs.ensureDir(path.dirname(MAP_CACHE_PATH));
  let cache = {};
  try {
    if (await fs.pathExists(MAP_CACHE_PATH)) {
      cache = await fs.readJSON(MAP_CACHE_PATH);
    }
  } catch (e) {
    console.warn("Failed to read map cache:", e);
  }

  const allImages = await getAllImages("");
  const newCache = {};
  const tasks = [];

  for (const img of allImages) {
    const filePath = safeJoin(STORAGE_PATH, img.relPath);
    // We parse the ISO string from getAllImages to get timestamp
    const lastModified = new Date(img.uploadTime).getTime();
    const key = img.relPath;

    if (cache[key] && cache[key].lastModified === lastModified) {
      newCache[key] = cache[key];
      // Backfill thumbhash if missing in cache
      if (!newCache[key].thumbhash) {
         tasks.push(async () => {
             const filePath = safeJoin(STORAGE_PATH, img.relPath);
             newCache[key].thumbhash = await getThumbHash(filePath);
         });
      }
    } else {
      tasks.push(async () => {
        try {
          // Parse all metadata to ensure we get calculated GPS coordinates
          // Using 'pick' sometimes fails to return calculated latitude/longitude
          const meta = await exifr.parse(filePath, {
            gps: true,
          });

          if (meta && meta.latitude && meta.longitude) {
            const date =
              meta.DateTimeOriginal || meta.CreateDate || img.uploadTime;
            
            // Re-check thumbhash as it might have been missing
            const thumbUrl = `${img.url}?w=200`;
            const thumbhash = await getThumbHash(filePath);

            newCache[key] = {
              filename: img.filename,
              relPath: img.relPath,
              lat: meta.latitude,
              lng: meta.longitude,
              date:
                date instanceof Date
                  ? date.toISOString()
                  : new Date(date).toISOString(),
              thumbUrl: thumbUrl, 
              thumbhash: thumbhash,
              lastModified: lastModified,
              orientation: meta.Orientation // Store orientation to help frontend if needed
            };
          }
        } catch (err) {
          // Ignore errors or no GPS
        }
      });
    }
  }

  // Run tasks in chunks to avoid resource exhaustion
  const chunkSize = config.cache.mapCacheChunkSize;
  for (let i = 0; i < tasks.length; i += chunkSize) {
    await Promise.all(tasks.slice(i, i + chunkSize).map((t) => t()));
  }

  await fs.writeJSON(MAP_CACHE_PATH, newCache);
  return Object.values(newCache);
}

// 处理 multer 错误的中间件
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    // 处理 Multer 错误
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        error: `文件大小超过限制，最大允许 ${Math.round((config.upload.maxFileSize / (1024 * 1024)) * 100) / 100}MB`
      });
    }
    return res.status(400).json({ success: false, error: `上传错误: ${err.message}` });
  } else if (err) {
    // 处理其他错误
    return res.status(400).json({ success: false, error: err.message });
  }
  next();
};

// Map Data Endpoint
app.get("/api/map-data", requirePassword, async (req, res) => {
  try {
    const data = await updateMapCache();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/map/photos - 获取带有地理位置信息的图片列表 (兼容前端 MapView.vue)
app.get("/api/map/photos", requirePassword, async (req, res) => {
  try {
    const data = await updateMapCache();
    // 转换为前端期望的格式
    const photos = data.map(item => ({
      id: item.relPath,
      filename: item.filename,
      lat: item.lat,
      lng: item.lng,
      date: item.date,
      thumbUrl: item.thumbUrl,
      thumbhash: item.thumbhash
    }));
    res.json({ success: true, data: photos });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 公开 API 端点 (/i 系列) ==========

// GET /i - 获取公开 API 端点列表
app.get("/i", async (req, res) => {
  try {
    const directories = await getDirectories("");

    // 只返回公开的相册作为 API 端点
    const endpoints = directories
      .filter(dir => !dir.locked)
      .map(dir => ({
        name: dir.name,
        endpoint: `/i/${encodeURIComponent(dir.name)}`,
        usage: {
          random: `/i/${encodeURIComponent(dir.name)}`,
          list: `/i/${encodeURIComponent(dir.name)}?json=true`,
          specific: `/i/${encodeURIComponent(dir.name)}/{filename}`
        }
      }));

    res.json({
      success: true,
      baseUrl: getBaseUrl(req),
      endpoints
    });
  } catch (error) {
    console.error("获取公开端点错误:", error);
    res.status(500).json({ error: "获取公开端点失败" });
  }
});

// GET /i/:slug - 随机图片或图片列表
app.get("/i/:slug", async (req, res) => {
  try {
    const slug = decodeURIComponent(req.params.slug);
    const dirPath = safeJoin(STORAGE_PATH, slug);

    // 检查目录是否存在
    if (!(await fs.pathExists(dirPath))) {
      return res.status(404).json({ error: "目录不存在" });
    }

    // 检查是否被锁定
    if (await isAlbumLocked(slug)) {
      return res.status(403).json({ error: "此目录需要密码访问" });
    }

    const images = await getAllImages(slug);

    if (images.length === 0) {
      return res.status(404).json({ error: "没有找到图片" });
    }

    // 如果请求 json 格式，返回图片列表
    if (req.query.json === "true") {
      return res.json({
        success: true,
        data: images.map(img => ({
          filename: img.filename,
          url: `${getBaseUrl(req)}${img.url}`,
          size: img.size
        }))
      });
    }

    // 否则随机重定向到一张图片
    const randomImage = images[Math.floor(Math.random() * images.length)];
    res.redirect(302, randomImage.url);
  } catch (error) {
    console.error("公开API错误:", error);
    res.status(500).json({ error: "获取图片失败" });
  }
});

// GET /i/:slug/:filename - 获取特定图片
app.get("/i/:slug/*", async (req, res) => {
  try {
    const slug = decodeURIComponent(req.params.slug);
    const filename = decodeURIComponent(req.params[0]);
    const relPath = `${slug}/${filename}`;

    // 检查是否被锁定
    if (await isAlbumLocked(slug)) {
      return res.status(403).json({ error: "此目录需要密码访问" });
    }

    const filePath = safeJoin(STORAGE_PATH, relPath);

    if (!(await fs.pathExists(filePath))) {
      return res.status(404).json({ error: "图片不存在" });
    }

    const mimeType = mime.lookup(filePath) || "application/octet-stream";
    res.setHeader("Content-Type", mimeType);
    res.sendFile(filePath);
  } catch (error) {
    console.error("公开API错误:", error);
    res.status(500).json({ error: "获取图片失败" });
  }
});

// ========== 统一 API 端点 (兼容 client-vue 前端) ==========

// GET /api/files - 获取文件列表 (兼容前端调用)
app.get("/api/files", requirePassword, async (req, res) => {
  try {
    // 兼容前端参数: albumId -> dir, limit -> pageSize, q -> search
    let dir = req.query.albumId || req.query.dir || "";
    dir = dir.replace(/\\/g, "/");

    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.limit) || parseInt(req.query.pageSize) || 20;
    const search = req.query.q || req.query.search || "";

    const albumPassword = req.headers["x-album-password"];

    if (dir && await isAlbumLocked(dir)) {
      if (!albumPassword || !(await verifyAlbumPassword(dir, albumPassword))) {
        return res.status(403).json({ success: false, error: "需要访问密码", locked: true });
      }
    }

    let images = await getAllImages(dir, albumPassword);
    images.sort((a, b) => new Date(b.uploadTime).getTime() - new Date(a.uploadTime).getTime());

    if (search) {
      images = images.filter((image) =>
        image.filename.toLowerCase().includes(search.toLowerCase())
      );
    }

    const total = images.length;
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedImages = images.slice(startIndex, endIndex);

    // 转换为前端期望的格式
    // 性能优化: 在循环外一次性读取标签数据，避免重复IO
    const tagsData = await readAllTags();
    const formattedImages = [];
    for (const img of paginatedImages) {
      const filePath = safeJoin(STORAGE_PATH, img.relPath);
      const thumbhash = await getThumbHash(filePath);

      // 获取 MIME 类型
      const mimeType = mime.lookup(filePath) || "application/octet-stream";

      // 尝试获取图片尺寸 (性能考虑：仅对分页后的图片获取)
      let width = null;
      let height = null;
      try {
        const metadata = await sharp(filePath).metadata();
        width = metadata.width || null;
        height = metadata.height || null;
      } catch (e) {
        // 获取元数据失败，忽略
      }

      // 获取文件标签 (使用循环外读取的数据)
      const fileTags = tagsData.fileTags?.[img.relPath] || [];

      formattedImages.push({
        id: img.relPath, // 使用 relPath 作为唯一ID
        filename: img.filename,
        originalName: img.filename, // 兼容前端期望的字段名
        relPath: img.relPath,
        size: img.size,
        uploadTime: img.uploadTime,
        createdAt: img.uploadTime, // 兼容前端期望的字段名
        url: img.url,
        thumbhash: thumbhash,
        mimeType: mimeType, // 添加 MIME 类型
        width: width,
        height: height,
        tags: fileTags // 添加实际标签
      });
    }

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    res.json({
      success: true,
      data: formattedImages,
      pagination: {
        current: page,
        pageSize: pageSize,
        total: total,
        totalPages: Math.ceil(total / pageSize),
        hasMore: endIndex < total
      },
    });
  } catch (error) {
    console.error("获取文件列表错误:", error);
    res.status(500).json({ error: "获取文件列表失败" });
  }
});

// POST /api/files/upload - 上传文件 (兼容前端调用)
app.post(
  "/api/files/upload",
  uploadLimiter,
  requirePassword,
  upload.single("file"),
  handleMulterError,
  async (req, res) => {
    let finalFilePath = null; // 用于错误时清理文件
    try {
      // 兼容前端参数: albumId -> dir
      let dir = req.query.albumId || req.body.albumId || req.body.dir || req.query.dir || "";
      dir = dir.replace(/\\/g, "/");

      if (!req.file) {
        return res.status(400).json({ success: false, error: "没有选择文件" });
      }

      if (dir) {
        const targetDir = path.join(STORAGE_PATH, dir);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        const oldPath = req.file.path;
        const newPath = path.join(targetDir, req.file.filename);
        if (oldPath !== newPath && fs.existsSync(oldPath)) {
          fs.renameSync(oldPath, newPath);
        }
      }

      const relPath = path.join(dir, req.file.filename).replace(/\\/g, "/");
      finalFilePath = safeJoin(STORAGE_PATH, relPath);

      // 校验文件完整性
      const clientChecksum = req.body.checksum;
      if (clientChecksum) {
        // 计算服务端文件的 SHA-256
        const fileBuffer = await fs.readFile(finalFilePath);
        const serverChecksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');

        if (clientChecksum !== serverChecksum) {
          // 校验失败，删除不完整的文件
          console.error(`[Upload] Checksum mismatch for ${relPath}: client=${clientChecksum.substring(0, 16)}... server=${serverChecksum.substring(0, 16)}...`);
          await fs.remove(finalFilePath);
          return res.status(400).json({
            success: false,
            error: "文件完整性校验失败，请重新上传",
            code: "CHECKSUM_MISMATCH"
          });
        }
        console.log(`[Upload] Checksum verified for ${relPath}`);
      }

      let originalName = req.file.originalname;
      if (!/[^\u0000-\u00ff]/.test(originalName)) {
        try {
          originalName = Buffer.from(originalName, "latin1").toString("utf8");
        } catch (e) {}
      }

      const safeFilename = sanitizeFilename(req.file.filename);
      const thumbhash = await generateThumbHash(finalFilePath);

      const fileInfo = {
        id: relPath,
        filename: safeFilename,
        originalName: originalName,
        size: req.file.size,
        mimetype: req.file.mimetype,
        uploadTime: new Date().toISOString(),
        url: `/api/images/${relPath.split("/").map(encodeURIComponent).join("/")}`,
        relPath,
        fullUrl: `${getBaseUrl(req)}/api/images/${relPath.split("/").map(encodeURIComponent).join("/")}`,
        thumbhash,
      };

      res.json({
        success: true,
        message: "文件上传成功",
        data: fileInfo,
      });
    } catch (error) {
      console.error("上传错误:", error);
      // 如果出错且文件已保存，尝试清理
      if (finalFilePath && await fs.pathExists(finalFilePath)) {
        try {
          await fs.remove(finalFilePath);
        } catch (cleanupErr) {
          console.error("清理失败文件出错:", cleanupErr);
        }
      }
      res.status(500).json({ success: false, error: "上传失败，请稍后重试" });
    }
  }
);

// POST /api/files/batch/delete - 批量删除文件
app.post("/api/files/batch/delete", requirePassword, async (req, res) => {
  try {
    const { fileIds } = req.body;
    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: "未选择文件" });
    }

    let successCount = 0;
    let failCount = 0;

    for (const fileId of fileIds) {
      try {
        const relPath = decodeURIComponent(fileId).replace(/\\/g, "/");
        const filePath = safeJoin(STORAGE_PATH, relPath);

        if (await fs.pathExists(filePath)) {
          await moveToTrash(filePath);
          await deleteThumbHash(filePath);
          successCount++;
        } else {
          failCount++;
        }
      } catch (e) {
        console.error(`Delete failed for ${fileId}:`, e);
        failCount++;
      }
    }

    res.json({
      success: true,
      message: `成功删除 ${successCount} 个文件` + (failCount > 0 ? `，失败 ${failCount} 个` : ""),
      data: { successCount, failCount }
    });
  } catch (e) {
    console.error("Batch delete error:", e);
    res.status(500).json({ error: "批量删除失败" });
  }
});

// PATCH /api/files/:id - 更新文件信息（重命名等）(兼容前端 ImageDetailModal.vue)
app.patch("/api/files/:id(*)", requirePassword, async (req, res) => {
  try {
    // id 是文件的 relPath（可能包含路径分隔符）
    const relPath = decodeURIComponent(req.params.id).replace(/\\/g, "/");
    const { originalName, newName } = req.body;

    // 支持 originalName 或 newName 参数
    const targetName = originalName || newName;

    if (!targetName) {
      return res.status(400).json({ success: false, error: "缺少新文件名参数" });
    }

    const oldFilePath = safeJoin(STORAGE_PATH, relPath);

    if (!(await fs.pathExists(oldFilePath))) {
      return res.status(404).json({ success: false, error: "文件不存在" });
    }

    const currentDir = path.dirname(relPath).replace(/\\/g, "/");
    const origExt = path.extname(relPath);

    // 处理新名称
    let newFileName = sanitizeFilename(targetName.trim());
    if (!path.extname(newFileName)) {
      newFileName = `${path.basename(newFileName)}${origExt}`;
    }

    // 目标路径
    const targetDir = safeJoin(STORAGE_PATH, currentDir === "." ? "" : currentDir);
    await fs.ensureDir(targetDir);
    let newRelPath = path.join(currentDir === "." ? "" : currentDir, newFileName).replace(/\\/g, "/");
    let newFilePath = safeJoin(STORAGE_PATH, newRelPath);

    // 处理重复策略
    if (!config.upload.allowDuplicateNames && oldFilePath !== newFilePath) {
      const nameWithoutExt = path.basename(newFileName, path.extname(newFileName));
      const extension = path.extname(newFileName);
      let finalName = newFileName;
      let counter = 1;

      while (await fs.pathExists(newFilePath)) {
        if (config.upload.duplicateStrategy === "timestamp") {
          finalName = `${nameWithoutExt}_${Date.now()}_${counter}${extension}`;
        } else if (config.upload.duplicateStrategy === "counter") {
          finalName = `${nameWithoutExt}_${counter}${extension}`;
        } else if (config.upload.duplicateStrategy === "overwrite") {
          break;
        }
        newRelPath = path.join(currentDir === "." ? "" : currentDir, finalName).replace(/\\/g, "/");
        newFilePath = safeJoin(STORAGE_PATH, newRelPath);
        counter++;
      }
    }

    // 执行重命名
    if (oldFilePath !== newFilePath) {
      await fs.rename(oldFilePath, newFilePath);
      await moveThumbHash(oldFilePath, newFilePath);

      // 更新标签数据中的文件路径引用
      const tagsData = await readAllTags();
      if (tagsData.fileTags && tagsData.fileTags[relPath]) {
        tagsData.fileTags[newRelPath] = tagsData.fileTags[relPath];
        delete tagsData.fileTags[relPath];
        await saveAllTags(tagsData);
      }
    }

    const stats = await fs.stat(newFilePath);
    const updated = {
      id: newRelPath,
      filename: path.basename(newRelPath),
      originalName: path.basename(newRelPath),
      relPath: newRelPath,
      size: stats.size,
      uploadTime: stats.mtime.toISOString(),
      url: `/api/images/${newRelPath.split("/").map(encodeURIComponent).join("/")}`,
    };

    return res.json({ success: true, message: "文件名已更新", data: updated });
  } catch (e) {
    console.error("文件重命名错误:", e);
    return res.status(400).json({ success: false, error: e.message || "重命名失败" });
  }
});

// ========== Albums API (相册管理) ==========

// GET /api/albums - 获取相册列表
app.get("/api/albums", requirePassword, async (req, res) => {
  try {
    const parentId = req.query.parentId || "";
    const flat = req.query.flat === "true";

    const directories = await getDirectories(parentId);

    // 转换为前端期望的格式
    const albums = await Promise.all(directories.map(async (dir) => {
      // 计算相册内文件数量
      const images = await getAllImages(dir.path);
      return {
        id: dir.path,
        slug: dir.path.replace(/\//g, "-") || dir.name,
        name: dir.name,
        parentId: parentId || null,
        isPublic: !dir.locked,
        fileCount: images.length,
        previews: dir.previews,
        createdAt: dir.mtime.toISOString(),
        updatedAt: dir.mtime.toISOString()
      };
    }));

    res.json({
      success: true,
      data: albums,
    });
  } catch (error) {
    console.error("获取相册列表错误:", error);
    res.status(500).json({ error: "获取相册列表失败" });
  }
});

// POST /api/albums - 创建相册
app.post("/api/albums", requirePassword, async (req, res) => {
  try {
    const { name, parentId, isPublic } = req.body;
    if (!name) return res.status(400).json({ error: "Missing name" });

    const basePath = parentId || "";
    const relativePath = path.join(basePath, sanitizeFilename(name)).replace(/\\/g, "/");
    const dirPath = safeJoin(STORAGE_PATH, relativePath);

    if (await fs.pathExists(dirPath)) {
      return res.status(400).json({ error: "相册已存在" });
    }

    await fs.ensureDir(dirPath);

    res.json({
      success: true,
      message: "创建成功",
      data: {
        id: relativePath,
        slug: relativePath.replace(/\//g, "-") || name,
        name: name,
        parentId: parentId || null,
        isPublic: isPublic !== false,
        fileCount: 0,
        createdAt: new Date().toISOString()
      }
    });
  } catch (e) {
    console.error("Create album error:", e);
    res.status(500).json({ error: "创建相册失败" });
  }
});

// GET /api/albums/:id - 获取单个相册
app.get("/api/albums/:id", requirePassword, async (req, res) => {
  try {
    const albumId = decodeURIComponent(req.params.id).replace(/-/g, "/");
    const dirPath = safeJoin(STORAGE_PATH, albumId);

    if (!(await fs.pathExists(dirPath))) {
      return res.status(404).json({ error: "相册不存在" });
    }

    const stats = await fs.stat(dirPath);
    if (!stats.isDirectory()) {
      return res.status(404).json({ error: "相册不存在" });
    }

    const isLocked = await isAlbumLocked(albumId);
    const images = isLocked ? [] : await getAllImages(albumId);
    const previews = isLocked ? [] : await getPreviewImages(albumId, 3);

    res.json({
      success: true,
      data: {
        id: albumId,
        slug: albumId.replace(/\//g, "-") || path.basename(albumId),
        name: path.basename(albumId),
        parentId: path.dirname(albumId) === "." ? null : path.dirname(albumId),
        isPublic: !isLocked,
        fileCount: images.length,
        previews: previews,
        createdAt: stats.birthtime ? stats.birthtime.toISOString() : stats.mtime.toISOString(),
        updatedAt: stats.mtime.toISOString()
      }
    });
  } catch (e) {
    console.error("Get album error:", e);
    res.status(500).json({ error: "获取相册失败" });
  }
});

// PATCH /api/albums/:id - 更新相册
app.patch("/api/albums/:id", requirePassword, async (req, res) => {
  try {
    const albumId = decodeURIComponent(req.params.id).replace(/-/g, "/");
    const { name, isPublic } = req.body;
    const dirPath = safeJoin(STORAGE_PATH, albumId);

    if (!(await fs.pathExists(dirPath))) {
      return res.status(404).json({ error: "相册不存在" });
    }

    // 处理公开/私有切换 (通过密码控制)
    if (typeof isPublic === "boolean") {
      const configPath = getAlbumPasswordPath(albumId);
      if (isPublic) {
        // 设为公开 = 移除密码
        if (await fs.pathExists(configPath)) {
          await fs.remove(configPath);
        }
      }
      // 设为私有需要用户单独设置密码，这里不处理
    }

    // 处理重命名
    let newAlbumId = albumId;
    if (name && name !== path.basename(albumId)) {
      const parentDir = path.dirname(albumId);
      const newName = sanitizeFilename(name);
      newAlbumId = path.join(parentDir === "." ? "" : parentDir, newName).replace(/\\/g, "/");
      const newDirPath = safeJoin(STORAGE_PATH, newAlbumId);

      if (await fs.pathExists(newDirPath)) {
        return res.status(400).json({ error: "目标相册名已存在" });
      }

      await fs.rename(dirPath, newDirPath);
    }

    const newDirPath = safeJoin(STORAGE_PATH, newAlbumId);
    const stats = await fs.stat(newDirPath);
    const isLocked = await isAlbumLocked(newAlbumId);
    const images = await getAllImages(newAlbumId);

    res.json({
      success: true,
      message: "更新成功",
      data: {
        id: newAlbumId,
        slug: newAlbumId.replace(/\//g, "-") || path.basename(newAlbumId),
        name: path.basename(newAlbumId),
        isPublic: !isLocked,
        fileCount: images.length,
        updatedAt: stats.mtime.toISOString()
      }
    });
  } catch (e) {
    console.error("Update album error:", e);
    res.status(500).json({ error: "更新相册失败" });
  }
});

// DELETE /api/albums/:id - 删除相册
app.delete("/api/albums/:id", requirePassword, async (req, res) => {
  try {
    const albumId = decodeURIComponent(req.params.id).replace(/-/g, "/");
    const dirPath = safeJoin(STORAGE_PATH, albumId);

    if (!(await fs.pathExists(dirPath))) {
      return res.status(404).json({ error: "相册不存在" });
    }

    // 将整个目录移到回收站
    const dirName = path.basename(dirPath);
    const timestamp = Date.now();
    const trashName = `${dirName}_${timestamp}`;
    const trashPath = path.join(STORAGE_PATH, TRASH_DIR_NAME, trashName);

    await fs.ensureDir(path.dirname(trashPath));
    await fs.move(dirPath, trashPath, { overwrite: true });

    res.json({ success: true, message: "相册已删除" });
  } catch (e) {
    console.error("Delete album error:", e);
    res.status(500).json({ error: "删除相册失败" });
  }
});

// ========== Tags API (标签管理) ==========

const TAGS_FILE = "tags.json";

// 获取标签文件路径
function getTagsFilePath() {
  return path.join(STORAGE_PATH, CONFIG_DIR_NAME, TAGS_FILE);
}

// 读取所有标签
async function readAllTags() {
  try {
    const filePath = getTagsFilePath();
    if (await fs.pathExists(filePath)) {
      return await fs.readJSON(filePath);
    }
  } catch (e) {
    console.error("Read tags failed:", e);
  }
  return { tags: [], fileTags: {} };
}

// 保存所有标签
async function saveAllTags(data) {
  try {
    const filePath = getTagsFilePath();
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeJSON(filePath, data, { spaces: 2 });
  } catch (e) {
    console.error("Save tags failed:", e);
  }
}

// GET /api/tags - 获取所有标签
app.get("/api/tags", requirePassword, async (req, res) => {
  try {
    const data = await readAllTags();

    // 兼容旧格式（字符串数组）和新格式（对象数组）
    let tagsArray = data.tags || [];
    const tagMeta = data.tagMeta || {}; // { tagName: { color, ... } }
    const fileTags = data.fileTags || {};

    // 计算每个标签的文件数量
    const tagFileCount = {};
    for (const fileId in fileTags) {
      const tags = fileTags[fileId] || [];
      for (const tag of tags) {
        tagFileCount[tag] = (tagFileCount[tag] || 0) + 1;
      }
    }

    // 转换为前端期望的格式
    const formattedTags = tagsArray.map((tag, index) => {
      // 如果是字符串，转换为对象
      const tagName = typeof tag === 'string' ? tag : tag.name;
      const meta = tagMeta[tagName] || {};
      return {
        id: tagName, // 使用名称作为ID
        name: tagName,
        color: meta.color || '#3b82f6', // 默认蓝色
        fileCount: tagFileCount[tagName] || 0
      };
    });

    res.json({
      success: true,
      data: formattedTags
    });
  } catch (e) {
    console.error("Get tags error:", e);
    res.status(500).json({ error: "获取标签失败" });
  }
});

// POST /api/tags - 创建标签
app.post("/api/tags", requirePassword, async (req, res) => {
  try {
    // 兼容前端两种参数格式: { tag } 或 { name }
    const tagName = req.body.tag || req.body.name;
    const tagColor = req.body.color || '#3b82f6';
    if (!tagName) return res.status(400).json({ error: "Missing tag or name" });

    const data = await readAllTags();

    // 确保 tags 是字符串数组
    if (!Array.isArray(data.tags)) data.tags = [];
    if (!data.tagMeta) data.tagMeta = {};

    // 添加标签（如果不存在）
    if (!data.tags.includes(tagName)) {
      data.tags.push(tagName);
    }

    // 保存标签元数据（颜色等）
    data.tagMeta[tagName] = {
      ...data.tagMeta[tagName],
      color: tagColor
    };

    await saveAllTags(data);

    // 返回新创建的标签对象
    res.json({
      success: true,
      data: {
        id: tagName,
        name: tagName,
        color: tagColor,
        fileCount: 0
      }
    });
  } catch (e) {
    console.error("Create tag error:", e);
    res.status(500).json({ error: "创建标签失败" });
  }
});

// POST /api/tags/files/:id/add - 为文件添加标签
app.post("/api/tags/files/:id/add", requirePassword, async (req, res) => {
  try {
    const fileId = decodeURIComponent(req.params.id);
    const { tag } = req.body;
    if (!tag) return res.status(400).json({ error: "Missing tag" });

    const data = await readAllTags();

    // 确保标签存在
    if (!data.tags.includes(tag)) {
      data.tags.push(tag);
    }

    // 为文件添加标签
    if (!data.fileTags) data.fileTags = {};
    if (!data.fileTags[fileId]) data.fileTags[fileId] = [];
    if (!data.fileTags[fileId].includes(tag)) {
      data.fileTags[fileId].push(tag);
    }

    await saveAllTags(data);

    res.json({
      success: true,
      data: { tags: data.fileTags[fileId] }
    });
  } catch (e) {
    console.error("Add tag error:", e);
    res.status(500).json({ error: "添加标签失败" });
  }
});

// POST /api/tags/files/:id/remove - 从文件移除标签
app.post("/api/tags/files/:id/remove", requirePassword, async (req, res) => {
  try {
    const fileId = decodeURIComponent(req.params.id);
    const { tag } = req.body;
    if (!tag) return res.status(400).json({ error: "Missing tag" });

    const data = await readAllTags();

    if (data.fileTags && data.fileTags[fileId]) {
      const idx = data.fileTags[fileId].indexOf(tag);
      if (idx !== -1) {
        data.fileTags[fileId].splice(idx, 1);
        await saveAllTags(data);
      }
    }

    res.json({
      success: true,
      data: { tags: data.fileTags?.[fileId] || [] }
    });
  } catch (e) {
    console.error("Remove tag error:", e);
    res.status(500).json({ error: "移除标签失败" });
  }
});

// ========== 原有 API 端点 (保留必要的) ==========

// Set Album Password
app.post("/api/album/password", requirePassword, async (req, res) => {
    try {
        const { dir, password } = req.body;
        // dir is required, but empty string (root) is valid too? Usually root doesn't have password logic implemented yet
        // but let's allow it if logic supports it.
        // However, `req.body.dir` being undefined check is good.
        if (dir === undefined) return res.status(400).json({ error: "Missing directory" });

        const configPath = getAlbumPasswordPath(dir);

        if (!password) {
            // Remove password
            if (await fs.pathExists(configPath)) {
                await fs.remove(configPath);
            }
            return res.json({ success: true, message: "密码已移除" });
        }

        // Hash password using bcrypt (cost factor 10)
        const hashedPassword = await bcrypt.hash(password, 10);

        // Set password
        await fs.ensureDir(path.dirname(configPath));
        await fs.writeJSON(configPath, { password: hashedPassword });
        res.json({ success: true, message: "密码设置成功" });
    } catch (e) {
        console.error("Set album password error:", e);
        res.status(500).json({ error: "设置密码失败" });
    }
});

// Verify Album Password
app.post("/api/album/verify", requirePassword, async (req, res) => {
    try {
        const { dir, password } = req.body;
        if (dir === undefined) return res.status(400).json({ error: "Missing directory" });

        const isValid = await verifyAlbumPassword(dir, password);
        if (isValid) {
            res.json({ success: true, message: "验证通过" });
        } else {
            res.status(401).json({ success: false, error: "密码错误" });
        }
    } catch (e) {
        console.error("Verify album password error:", e);
        res.status(500).json({ error: "验证失败" });
    }
});

// 3. 获取随机图片（支持dir参数）
app.get("/api/random", requirePassword, async (req, res) => {
  try {
    let dir = req.query.dir || "";
    dir = dir.replace(/\\/g, "/");
    const images = await getAllImages(dir);
    if (images.length === 0) {
      return res.status(404).json({ error: "没有找到图片" });
    }
    const randomImage = images[Math.floor(Math.random() * images.length)];
    if (req.query.format === "json") {
      return res.json({
        success: true,
        data: randomImage,
      });
    }
    // 直接返回图片文件
    const filePath = safeJoin(STORAGE_PATH, randomImage.relPath);
    const mimeType = mime.lookup(filePath) || "application/octet-stream";
    res.setHeader("Content-Type", mimeType);
    res.sendFile(filePath, (err) => {
      if (err) {
        res.status(500).json({ error: "图片发送失败" });
      }
    });
  } catch (error) {
    console.error("获取随机图片错误:", error);
    res.status(500).json({ error: "获取随机图片失败" });
  }
});

// 4.2. 获取图片元信息（尺寸/格式/主色/EXIF等）- 必须优先于 /api/images/* 路由
app.get("/api/images/meta/*", requirePassword, async (req, res) => {
  const relPath = decodeURIComponent(req.params[0]);
  try {
    const filePath = safeJoin(STORAGE_PATH, relPath);
    if (!(await fs.pathExists(filePath))) {
      return res.status(404).json({ success: false, error: "图片不存在" });
    }
    const fstats = await fs.stat(filePath);
    const mimeType = mime.lookup(filePath) || "application/octet-stream";
    let meta = {};
    let exif = {};
    try {
      const img = sharp(filePath);
      const m = await img.metadata();
      const s = await img.stats();
      meta = {
        width: m.width || null,
        height: m.height || null,
        format: m.format || null,
        channels: m.channels || null,
        hasAlpha: m.hasAlpha === true || m.channels === 4,
        orientation: m.orientation || null,
        space: m.space || null,
        dominant: s.dominant || null,
        exifPresent: !!m.exif,
      };
      // 解析EXIF详细信息
      try {
        const ex = await exifr.parse(filePath, {
          tiff: true,
          ifd0: true,
          exif: true,
          gps: true,
        });
        if (ex) {
          const latitude = ex.latitude ?? ex.GPSLatitude ?? null;
          const longitude = ex.longitude ?? ex.GPSLongitude ?? null;
          const date =
            ex.DateTimeOriginal || ex.CreateDate || ex.ModifyDate || null;
          exif = {
            make: ex.Make || null,
            model: ex.Model || null,
            lensModel: ex.LensModel || null,
            dateTimeOriginal: date ? new Date(date).toISOString() : null,
            iso: ex.ISO || ex.ISOSpeedRatings || null,
            exposureTime: ex.ExposureTime || null,
            fNumber: ex.FNumber || null,
            focalLength: ex.FocalLength || null,
            latitude,
            longitude,
            altitude: ex.GPSAltitude ?? null,
          };
        }
      } catch (e) {
        // EXIF解析失败不阻断
      }
    } catch (e) {
      meta = {};
    }
    return res.json({
      success: true,
      data: {
        filename: path.basename(relPath),
        relPath: relPath.replace(/\\/g, "/"),
        size: fstats.size,
        uploadTime: fstats.mtime.toISOString(),
        createTime: fstats.birthtime ? fstats.birthtime.toISOString() : null,
        mime: mimeType,
        ...meta,
        exif,
      },
    });
  } catch (e) {
    return res.status(400).json({ success: false, error: "非法路径" });
  }
});

// 4. 获取指定图片（支持多层目录、实时处理）
app.get("/api/images/*", async (req, res) => {
  const relPath = decodeURIComponent(req.params[0]);
  try {
    const filePath = safeJoin(STORAGE_PATH, relPath);
    if (!(await fs.pathExists(filePath))) {
      return res.status(404).json({ error: "图片不存在" });
    }

    // Trigger ThumbHash generation if missing (async, non-blocking)
    getThumbHash(filePath).then(hash => {
        if (!hash) generateThumbHash(filePath);
    });

    const w = req.query.w ? parseInt(req.query.w) : undefined;
    const h = req.query.h ? parseInt(req.query.h) : undefined;
    const qRaw = req.query.q ? parseInt(req.query.q) : undefined;
    const q = qRaw && qRaw > 0 && qRaw <= 100 ? qRaw : undefined;
    let fmt = (req.query.fmt || "").toLowerCase();
    if (fmt === "jpg") fmt = "jpeg";
    const hasTransform = w || h || q || fmt;
    if (!hasTransform) {
      const mimeType = mime.lookup(filePath) || "application/octet-stream";
      res.setHeader("Content-Type", mimeType);
      return res.sendFile(filePath);
    }
    let img = sharp(filePath).rotate();
    if (w || h) {
      img = img.resize({
        width: w,
        height: h,
        fit: "cover",
        position: "center",
        withoutEnlargement: true,
      });
    }
    let outMime = mime.lookup(filePath) || "application/octet-stream";
    if (fmt === "webp") {
      img = img.webp({ quality: q ?? 80 });
      outMime = "image/webp";
    } else if (fmt === "jpeg") {
      img = img.jpeg({ quality: q ?? 80 });
      outMime = "image/jpeg";
    } else if (fmt === "png") {
      img = img.png();
      outMime = "image/png";
    } else if (fmt === "avif") {
      img = img.avif({ quality: q ?? 50 });
      outMime = "image/avif";
    } else if (q) {
      const orig = (mime.lookup(filePath) || "").toLowerCase();
      if (orig.includes("jpeg") || orig.includes("jpg")) {
        img = img.jpeg({ quality: q });
        outMime = "image/jpeg";
      } else if (orig.includes("webp")) {
        img = img.webp({ quality: q });
        outMime = "image/webp";
      } else if (orig.includes("avif")) {
        img = img.avif({ quality: q });
        outMime = "image/avif";
      } else {
        img = img.png();
        outMime = "image/png";
      }
    }
    const buffer = await img.toBuffer();
    res.setHeader("Content-Type", outMime);
    res.setHeader("Cache-Control", "public, max-age=31536000");
    res.send(buffer);
  } catch (e) {
    res.status(400).json({ error: "非法路径" });
  }
});

// 4.1. 获取指定文件（支持多层目录）
app.get("/api/files/*", (req, res) => {
  const relPath = decodeURIComponent(req.params[0]);
  try {
    const filePath = safeJoin(STORAGE_PATH, relPath);
    if (fs.existsSync(filePath)) {
      // 设置正确的Content-Type
      const mimeType = mime.lookup(filePath) || "application/octet-stream";
      res.setHeader("Content-Type", mimeType);
      res.sendFile(filePath);
    } else {
      res.status(404).json({ error: "文件不存在" });
    }
  } catch (e) {
    res.status(400).json({ error: "非法路径" });
  }
});

 

// 辅助函数：移动到回收站
async function moveToTrash(filePath) {
  try {
    const fileName = path.basename(filePath);
    // 使用时间戳避免重名冲突: filename_timestamp.ext
    const ext = path.extname(fileName);
    const nameWithoutExt = path.basename(fileName, ext);
    const timestamp = Date.now();
    const trashName = `${nameWithoutExt}_${timestamp}${ext}`;
    const trashPath = path.join(STORAGE_PATH, TRASH_DIR_NAME, trashName);

    // 确保回收站目录存在
    await fs.ensureDir(path.dirname(trashPath));
    // 移动文件
    await fs.move(filePath, trashPath, { overwrite: true });
    console.log(`[Trash] Moved to trash: ${trashName}`);
  } catch (error) {
    console.error("[Trash] Move failed:", error);
    // 如果移动失败，为了保证API行为一致性，可能需要回退或报错
    // 这里选择抛出错误，让上层处理
    throw error;
  }
}

// 辅助函数：清理回收站
async function cleanTrash() {
  const trashDir = path.join(STORAGE_PATH, TRASH_DIR_NAME);
  if (!(await fs.pathExists(trashDir))) return;

  try {
    const files = await fs.readdir(trashDir);
    const now = Date.now();
    const EXPIRE_TIME = config.trash.retentionDays * 24 * 60 * 60 * 1000;

    for (const file of files) {
      const filePath = path.join(trashDir, file);
      try {
        const stats = await fs.stat(filePath);
        if (now - stats.mtimeMs > EXPIRE_TIME) {
          await fs.remove(filePath);
          console.log(`[Trash] Cleaned expired file: ${file}`);
        }
      } catch (e) {
        console.error(`[Trash] Failed to check/delete file: ${file}`, e);
      }
    }
  } catch (e) {
    console.error("[Trash] Cleanup failed:", e);
  }
}

// 初始化回收站清理任务
function initTrashCleanup() {
  console.log(`[Trash] Initializing cleanup task (retention: ${config.trash.retentionDays} days, interval: ${config.trash.cleanupIntervalHours} hours)...`);
  // 立即执行一次
  cleanTrash();
  // 按配置的间隔执行
  setInterval(cleanTrash, config.trash.cleanupIntervalHours * 60 * 60 * 1000);
}

// 5. 删除图片（支持多层目录）
app.delete("/api/images/*", requirePassword, async (req, res) => {
  const relPath = decodeURIComponent(req.params[0]);
  try {
    const filePath = safeJoin(STORAGE_PATH, relPath);
    if (await fs.pathExists(filePath)) {
      // await fs.remove(filePath); // 改为软删除
      await moveToTrash(filePath);
      await deleteThumbHash(filePath);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "图片不存在" });
    }
  } catch (e) {
    res.status(400).json({ error: "非法路径" });
  }
});

// 5.1. 删除文件（支持多层目录）
app.delete("/api/files/*", requirePassword, async (req, res) => {
  const relPath = decodeURIComponent(req.params[0]);
  try {
    const filePath = safeJoin(STORAGE_PATH, relPath);
    if (await fs.pathExists(filePath)) {
      // await fs.remove(filePath); // 改为软删除
      await moveToTrash(filePath);
      res.json({ success: true, message: "文件已移至回收站" });
    } else {
      res.status(404).json({ error: "文件不存在" });
    }
  } catch (e) {
    res.status(400).json({ error: "非法路径" });
  }
});

// 批量移动图片
app.post("/api/batch/move", requirePassword, async (req, res) => {
    try {
        const { files, targetDir } = req.body;
        if (!Array.isArray(files) || files.length === 0) {
            return res.status(400).json({ error: "未选择文件" });
        }
        
        let newDir = targetDir || "";
        newDir = newDir.replace(/\\/g, "/").trim();
        const absTargetDir = safeJoin(STORAGE_PATH, newDir);
        await fs.ensureDir(absTargetDir);
        
        let successCount = 0;
        let failCount = 0;
        
        for (const relPath of files) {
            try {
                const oldRelPath = decodeURIComponent(relPath).replace(/\\/g, "/");
                const oldFilePath = safeJoin(STORAGE_PATH, oldRelPath);
                
                if (await fs.pathExists(oldFilePath)) {
                    const filename = path.basename(oldFilePath);
                    let newRelPath = path.join(newDir, filename).replace(/\\/g, "/");
                    let newFilePath = safeJoin(STORAGE_PATH, newRelPath);
                    
                    // Handle duplicates
                    if (oldFilePath !== newFilePath) {
                         if (!config.upload.allowDuplicateNames && await fs.pathExists(newFilePath)) {
                            const ext = path.extname(filename);
                            const nameWithoutExt = path.basename(filename, ext);
                            let counter = 1;
                            let finalName = filename;
                            
                            while (await fs.pathExists(newFilePath)) {
                                if (config.upload.duplicateStrategy === "overwrite") break;
                                
                                if (config.upload.duplicateStrategy === "timestamp") {
                                    finalName = `${nameWithoutExt}_${Date.now()}_${counter}${ext}`;
                                } else {
                                    // counter
                                    finalName = `${nameWithoutExt}_${counter}${ext}`;
                                }
                                newRelPath = path.join(newDir, finalName).replace(/\\/g, "/");
                                newFilePath = safeJoin(STORAGE_PATH, newRelPath);
                                counter++;
                            }
                        }
                        
                        if (oldFilePath !== newFilePath) {
                            await fs.rename(oldFilePath, newFilePath);
                            await moveThumbHash(oldFilePath, newFilePath);
                            successCount++;
                        } else {
                            // Same file, technically success
                            successCount++;
                        }
                    } else {
                        successCount++;
                    }
                } else {
                    failCount++;
                }
            } catch (e) {
                console.error(`Move failed for ${relPath}:`, e);
                failCount++;
            }
        }
        
        res.json({ 
            success: true, 
            message: `成功移动 ${successCount} 个文件` + (failCount > 0 ? `，失败 ${failCount} 个` : ""),
            data: { successCount, failCount }
        });
        
    } catch (e) {
        console.error("Batch move error:", e);
        res.status(500).json({ error: "批量移动失败" });
    }
});

// 图片重命名（支持多层目录）
app.put("/api/images/*", requirePassword, async (req, res) => {
  const relPath = decodeURIComponent(req.params[0]);
  try {
    const oldFilePath = safeJoin(STORAGE_PATH, relPath);
    if (!(await fs.pathExists(oldFilePath))) {
      return res.status(404).json({ success: false, error: "图片不存在" });
    }
    // 支持重命名与移动目录
    let newName = req.body.newName || req.query.newName || null;
    let newDir = req.body.newDir || req.query.newDir || null;

    const currentDir = path.dirname(relPath).replace(/\\/g, "/");
    const origExt = path.extname(relPath);
    const origBase = path.basename(relPath);

    // 处理新名称
    if (typeof newName === "string") {
      newName = sanitizeFilename(newName.trim());
      if (!path.extname(newName)) {
        newName = `${path.basename(newName)}${origExt}`;
      }
    } else {
      newName = origBase;
    }

    // 处理新目录
    if (typeof newDir === "string") {
      newDir = newDir.replace(/\\/g, "/").trim();
    } else {
      newDir = currentDir;
    }

    // 目标路径
    const targetDir = safeJoin(STORAGE_PATH, newDir);
    await fs.ensureDir(targetDir);
    let newRelPath = path.join(newDir, newName).replace(/\\/g, "/");
    let newFilePath = safeJoin(STORAGE_PATH, newRelPath);
    // 处理重复策略
    if (!config.upload.allowDuplicateNames && oldFilePath !== newFilePath) {
      const nameWithoutExt = path.basename(newName, path.extname(newName));
      const extension = path.extname(newName);
      let finalName = newName;
      let counter = 1;
      while (await fs.pathExists(newFilePath)) {
        if (config.upload.duplicateStrategy === "timestamp") {
          finalName = `${nameWithoutExt}_${Date.now()}_${counter}${extension}`;
        } else if (config.upload.duplicateStrategy === "counter") {
          finalName = `${nameWithoutExt}_${counter}${extension}`;
        } else if (config.upload.duplicateStrategy === "overwrite") {
          break;
        }
        newRelPath = path.join(newDir, finalName).replace(/\\/g, "/");
        newFilePath = safeJoin(STORAGE_PATH, newRelPath);
        counter++;
      }
    }
    // 执行重命名
    await fs.rename(oldFilePath, newFilePath);
    await moveThumbHash(oldFilePath, newFilePath);
    const stats = await fs.stat(newFilePath);
    const updated = {
      filename: path.basename(newRelPath),
      relPath: newRelPath,
      size: stats.size,
      uploadTime: stats.mtime.toISOString(),
      url: `/api/images/${newRelPath.split("/").map(encodeURIComponent).join("/")}`,
    };
    return res.json({ success: true, message: "更新成功", data: updated });
  } catch (e) {
    console.error("图片重命名错误:", e);
    return res.status(400).json({ success: false, error: e.message || "重命名失败" });
  }
});

const crypto = require("crypto");

// Get or create persistent share secret
const getShareSecret = () => {
    if (process.env.SHARE_SECRET) {
        return process.env.SHARE_SECRET;
    }
    
    // Store secret in config dir to persist across restarts
    const configDir = path.join(STORAGE_PATH, CONFIG_DIR_NAME);
    const secretPath = path.join(configDir, ".share_secret");
    
    try {
        fs.ensureDirSync(configDir);
        
        // Migration: check if old secret exists in root and move it
        const oldSecretPath = path.join(STORAGE_PATH, ".share_secret");
        if (fs.existsSync(oldSecretPath) && !fs.existsSync(secretPath)) {
            try {
                fs.renameSync(oldSecretPath, secretPath);
                return fs.readFileSync(secretPath, 'utf8').trim();
            } catch (e) {
                console.error("Migration of share secret failed:", e);
                // Continue to create new or read existing
            }
        }

        if (fs.existsSync(secretPath)) {
            return fs.readFileSync(secretPath, 'utf8').trim();
        } else {
            const newSecret = uuidv4();
            fs.writeFileSync(secretPath, newSecret);
            return newSecret;
        }
    } catch (e) {
        console.error("Failed to manage share secret:", e);
        return uuidv4(); // Fallback to memory-only if FS fails
    }
};

const SHARE_SECRET = getShareSecret();
const SHARES_FILE_NAME = "burned_tokens.json"; // Keep filename as requested by user, but content will be shares

// Helper to get share config path
const getShareConfigPath = (dirPath) => {
    const absDir = safeJoin(STORAGE_PATH, dirPath);
    return path.join(absDir, CONFIG_DIR_NAME, SHARES_FILE_NAME);
};

// Helper to read shares
const readShares = async (dirPath) => {
    try {
        const filePath = getShareConfigPath(dirPath);
        if (await fs.pathExists(filePath)) {
            return await fs.readJSON(filePath);
        }
    } catch (e) {
        // 读取分享配置失败，返回空数组
    }
    return [];
};

// Helper to write shares
const writeShares = async (dirPath, shares) => {
    try {
        const filePath = getShareConfigPath(dirPath);
        await fs.ensureDir(path.dirname(filePath));
        await fs.writeJSON(filePath, shares, { spaces: 2 });
    } catch (e) {
        console.error("Write shares failed:", e);
    }
};

// Helper to get previews
async function getPreviewImages(dir, limit = 3) {
  const absDir = safeJoin(STORAGE_PATH, dir);
  const previews = [];
  try {
    const files = await fs.readdir(absDir);
    // Sort by recent? Or just random? Let's try to get recent ones if possible, but stats are slow.
    // Let's just take first 3 images for performance, maybe sort by name.
    // To do it right: stat all, sort by mtime, take 3.
    // Optimization: limit the stat calls if directory is huge?
    // For now, let's just grab the first few images we find.
    for (const file of files) {
        if (previews.length >= limit) break;
        if (file === CACHE_DIR_NAME) continue;
        const filePath = path.join(absDir, file);
        const ext = path.extname(file).toLowerCase();
        if (config.upload.allowedExtensions.includes(ext)) {
            // Check if it's a file
            try {
                const stats = await fs.stat(filePath);
                if (stats.isFile()) {
                    const relPath = path.join(dir, file).replace(/\\/g, "/");
                    previews.push(`/api/images/${relPath.split("/").map(encodeURIComponent).join("/")}`);
                }
            } catch (e) {
                // 获取文件状态失败，跳过该文件
            }
        }
    }
  } catch (e) {
      // 读取目录失败，返回空预览
  }
  return previews;
}

// 6. 获取目录列表 (Modified to include previews)
async function getDirectories(dir = "") {
  const absDir = safeJoin(STORAGE_PATH, dir);
  let directories = [];

  try {
    const files = await fs.readdir(absDir);
    for (const file of files) {
      if (file === CACHE_DIR_NAME || file === CONFIG_DIR_NAME || file === TRASH_DIR_NAME) continue;
      const filePath = path.join(absDir, file);
      const stats = await fs.stat(filePath);
      if (stats.isDirectory()) {
        const relPath = path.join(dir, file).replace(/\\/g, "/");
        // Check locked status
        const isLocked = await isAlbumLocked(relPath);
        
        // If locked, maybe we shouldn't show previews? 
        // User said: "default loading does not load images of that album"
        // So previews should be empty if locked.
        const previews = isLocked ? [] : await getPreviewImages(relPath, 3);
        
        directories.push({
          name: file,
          path: relPath,
          fullPath: filePath,
          previews: previews,
          imageCount: previews.length, // Rough indicator
          mtime: stats.mtime,
          locked: isLocked
        });
      }
    }
    // 按目录名排序
    directories.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  } catch (error) {
    console.error("读取目录失败:", error);
  }

  return directories;
}

// 注意: /api/directories 端点已移除，请使用 /api/albums 代替

// Share API
app.post("/api/share/generate", requirePassword, async (req, res) => {
    try {
        const { path: sharePath, expireSeconds, burnAfterReading } = req.body;
        if (sharePath === undefined) return res.status(400).json({ error: "Missing path" });

        const payload = {
            p: sharePath,
            e: expireSeconds ? Date.now() + expireSeconds * 1000 : null,
            b: !!burnAfterReading,
            n: uuidv4() // Nonce
        };
        
        const dataStr = JSON.stringify(payload);
        const signature = crypto.createHmac("sha256", SHARE_SECRET).update(dataStr).digest("hex");
        const token = Buffer.from(JSON.stringify({ d: payload, s: signature })).toString("base64");
        
        // Save to local config
        const shares = await readShares(sharePath);
        shares.push({
            token,
            signature, // Used for quick lookup
            createdAt: Date.now(),
            expireSeconds,
            burnAfterReading: !!burnAfterReading,
            status: "active"
        });
        await writeShares(sharePath, shares);

        res.json({ success: true, token });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Generate share link failed" });
    }
});

// List shares
app.get("/api/share/list", requirePassword, async (req, res) => {
    try {
        const { path: sharePath } = req.query;
        if (sharePath === undefined) return res.status(400).json({ error: "Missing path" });
        
        const shares = await readShares(sharePath);
        // Filter out expired or revoked? Maybe show all but indicate status
        // Check expiry dynamically
        const now = Date.now();
        const result = shares.map(s => {
            let status = s.status;
            if (status === "active" && s.expireSeconds && (s.createdAt + s.expireSeconds * 1000 < now)) {
                status = "expired";
            }
            return { ...s, status };
        });
        
        res.json({ success: true, data: result });
    } catch (e) {
        res.status(500).json({ error: "List shares failed" });
    }
});

// Delete share
app.delete("/api/share/delete", requirePassword, async (req, res) => {
    try {
        const { path: sharePath, signature } = req.body;
        if (sharePath === undefined || !signature) return res.status(400).json({ error: "Missing params" });

        const shares = await readShares(sharePath);
        const newShares = shares.filter(s => s.signature !== signature);
        
        if (shares.length === newShares.length) {
            return res.status(404).json({ error: "Share not found" });
        }
        
        await writeShares(sharePath, newShares);
        res.json({ success: true });
    } catch (e) {
        console.error("Delete share failed:", e);
        res.status(500).json({ error: "Delete share failed" });
    }
});

// Revoke share
app.post("/api/share/revoke", requirePassword, async (req, res) => {
    try {
        const { path: sharePath, signature } = req.body;
        // Allow empty string for root path
        if (sharePath === undefined || !signature) return res.status(400).json({ error: "Missing params" });

        const shares = await readShares(sharePath);
        const index = shares.findIndex(s => s.signature === signature);
        if (index !== -1) {
            shares[index].status = "revoked";
            await writeShares(sharePath, shares);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: "Share not found" });
        }
    } catch (e) {
        res.status(500).json({ error: "Revoke failed" });
    }
});

app.get("/api/share/access", async (req, res) => {
    try {
        const { token } = req.query;
        if (!token) return res.status(400).json({ error: "Missing token" });

        let decoded;
        try {
            const jsonStr = Buffer.from(token, "base64").toString("utf8");
            decoded = JSON.parse(jsonStr);
        } catch (e) {
            return res.status(400).json({ error: "Invalid token format" });
        }

        const { d: payload, s: signature } = decoded;
        const expectedSig = crypto.createHmac("sha256", SHARE_SECRET).update(JSON.stringify(payload)).digest("hex");

        if (signature !== expectedSig) {
            return res.status(403).json({ error: "Invalid signature" });
        }

        // Check local config
        const dir = payload.p;
        const shares = await readShares(dir);
        const shareRecord = shares.find(s => s.signature === signature);
        
        if (!shareRecord) {
             // If not found in local config (maybe old token or deleted), fallback to payload validation only?
             // But user wants "manual revoke", so we MUST check record.
             // If record missing, treat as invalid or revoked.
             return res.status(403).json({ error: "分享记录不存在或已失效" });
        }

        if (shareRecord.status === "revoked") {
            return res.status(410).json({ error: "链接已失效" });
        }
        
        if (shareRecord.status === "burned") {
             return res.status(410).json({ error: "链接已失效（阅后即焚）" });
        }

        // Check expiry
        // Priority: Record > Payload (though they should match)
        if (payload.e && Date.now() > payload.e) {
            return res.status(410).json({ error: "链接已过期" });
        }
        
        // Also check creation time based expiry from record just in case
        if (shareRecord.expireSeconds && (shareRecord.createdAt + shareRecord.expireSeconds * 1000 < Date.now())) {
             return res.status(410).json({ error: "链接已过期" });
        }

        if (payload.b) {
            // Burn after reading
            // Update status to burned
            shareRecord.status = "burned";
            // Update in array
            const index = shares.findIndex(s => s.signature === signature);
            if (index !== -1) shares[index] = shareRecord;
            await writeShares(dir, shares);
        }

        // Token valid, return content
        let images = await getAllImages(dir);

        // Sort
        images.sort((a, b) => new Date(b.uploadTime).getTime() - new Date(a.uploadTime).getTime());

        // Pagination
        const page = parseInt(req.query.page) || 1;
        const pageSize = parseInt(req.query.pageSize) || 20;
        const total = images.length;
        const startIndex = (page - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const paginatedImages = images.slice(startIndex, endIndex);
        
        // ThumbHash
        for (const img of paginatedImages) {
             const filePath = safeJoin(STORAGE_PATH, img.relPath);
             img.thumbhash = await getThumbHash(filePath);
        }

        res.json({
            success: true,
            data: paginatedImages,
            dirName: path.basename(dir),
            pagination: {
                current: page,
                pageSize: pageSize,
                total: total,
                totalPages: Math.ceil(total / pageSize),
            }
        });

    } catch (e) {
        console.error("Share access error:", e);
        res.status(500).json({ error: "Share access failed" });
    }
});

// 7. 统计信息（递归统计所有目录）
async function getStats(dir = "") {
  const absDir = safeJoin(STORAGE_PATH, dir);
  let totalImages = 0;
  let totalSize = 0;
  let storagePath = absDir;
  const files = await fs.readdir(absDir);
  for (const file of files) {
    if (file === CACHE_DIR_NAME || file === CONFIG_DIR_NAME || file === TRASH_DIR_NAME) continue;
    const filePath = path.join(absDir, file);
    const stats = await fs.stat(filePath);
    if (stats.isDirectory()) {
      const subStats = await getStats(path.join(dir, file));
      totalImages += subStats.totalImages;
      totalSize += subStats.totalSize;
    } else {
      const ext = path.extname(file).toLowerCase();
      if (config.upload.allowedExtensions.includes(ext)) {
        totalImages++;
        totalSize += stats.size;
      }
    }
  }
  return { totalImages, totalSize, storagePath };
}

app.get("/api/stats", requirePassword, async (req, res) => {
  try {
    let dir = req.query.dir || "";
    dir = dir.replace(/\\/g, "/");
    const stats = await getStats(dir);
    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("获取统计信息错误:", error);
    res.status(500).json({ error: "获取统计信息失败" });
  }
});

// 启动服务
// 启动回收站清理任务
initTrashCleanup();

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// 认证相关接口
// 1. 检查是否需要密码保护
app.get("/api/auth/status", (req, res) => {
  res.json({
    requiresPassword: config.security.password.enabled,
  });
});

// 2. 验证密码
app.post("/api/auth/verify", (req, res) => {
  const { password } = req.body;

  if (!config.security.password.enabled) {
    return res.json({ success: true, message: "无需密码保护" });
  }

  if (!password) {
    return res.status(400).json({ error: "请提供密码" });
  }

  if (password !== config.security.password.accessPassword) {
    return res.status(401).json({ error: "密码错误" });
  }

  res.json({ success: true, message: "密码验证成功" });
});

// 配置API接口
app.get("/api/config", (req, res) => {
  try {
    // 返回前端需要的配置信息
    const frontendConfig = {
      upload: {
        allowedExtensions: config.upload.allowedExtensions,
        maxFileSize: config.upload.maxFileSize,
        maxFileSizeMB:
          Math.round((config.upload.maxFileSize / (1024 * 1024)) * 100) / 100,
        allowedFormats: config.upload.allowedExtensions
          .map((ext) => ext.replace(".", ""))
          .join(", ")
          .toUpperCase(),
      },
      storage: {
        path: config.storage.path,
      },
    };

    res.json({
      success: true,
      data: frontendConfig,
    });
  } catch (error) {
    console.error("获取配置错误:", error);
    res.status(500).json({ error: "获取配置失败" });
  }
});

// 图片处理接口
app.post(
  "/api/process-image",
  requirePassword,
  upload.single("image"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "没有选择图片文件" });
      }

      // 获取目标尺寸参数
      const width = parseInt(req.body.width || req.query.width);
      const height = parseInt(req.body.height || req.query.height);
      
      if (!width || !height || width <= 0 || height <= 0) {
        return res.status(400).json({ error: "请提供有效的宽度和高度参数" });
      }

      // 获取目录参数
      let dir = req.body.dir || req.query.dir || "";
      dir = dir.replace(/\\/g, "/");

      // 读取上传的图片
      const inputBuffer = await fs.readFile(req.file.path);
      
      // 获取原图片信息
      const metadata = await sharp(inputBuffer).metadata();
      
      // 计算缩放比例，保持纵横比
      const scaleX = width / metadata.width;
      const scaleY = height / metadata.height;
      const scale = Math.min(scaleX, scaleY);
      
      // 计算缩放后的尺寸
      const scaledWidth = Math.round(metadata.width * scale);
      const scaledHeight = Math.round(metadata.height * scale);
      
      // 计算居中位置
      const left = Math.round((width - scaledWidth) / 2);
      const top = Math.round((height - scaledHeight) / 2);

      // 创建透明背景并合成图片
      const processedBuffer = await sharp({
        create: {
          width: width,
          height: height,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 } // 透明背景
        }
      })
      .composite([
        {
          input: await sharp(inputBuffer)
            .resize(scaledWidth, scaledHeight)
            .toBuffer(),
          left: left,
          top: top
        }
      ])
      .png()
      .toBuffer();

      // 处理中文文件名
      let originalName = req.file.originalname;
      // 修复：如果包含非 Latin1 字符 (> 255)，说明已经是 UTF-8，不需要转换
      if (!/[^\u0000-\u00ff]/.test(originalName)) {
        try {
          originalName = Buffer.from(originalName, "latin1").toString("utf8");
        } catch (e) {}
      }

      // 生成处理后的文件名
      const ext = path.extname(originalName);
      const nameWithoutExt = path.basename(originalName, ext);
      let processedFilename = `${nameWithoutExt}_processed_${width}x${height}.png`;
      
      processedFilename = sanitizeFilename(processedFilename);
      
      // 处理文件名冲突
      const dest = safeJoin(STORAGE_PATH, dir);
      let finalFilename = processedFilename;
      let counter = 1;
      
      if (!config.upload.allowDuplicateNames) {
        while (fs.existsSync(path.join(dest, finalFilename))) {
          if (config.upload.duplicateStrategy === "timestamp") {
            finalFilename = `${nameWithoutExt}_processed_${width}x${height}_${Date.now()}_${counter}.png`;
          } else if (config.upload.duplicateStrategy === "counter") {
            finalFilename = `${nameWithoutExt}_processed_${width}x${height}_${counter}.png`;
          } else if (config.upload.duplicateStrategy === "overwrite") {
            break;
          }
          counter++;
        }
      }
      
      // 保存处理后的图片
      const processedFilePath = path.join(dest, finalFilename);
      await fs.writeFile(processedFilePath, processedBuffer);
      
      // 删除临时上传文件
      await fs.remove(req.file.path);
      
      const relPath = path.join(dir, finalFilename).replace(/\\/g, "/");
      
      const fileInfo = {
        filename: finalFilename,
        originalName: originalName,
        processedSize: { width, height },
        originalSize: { width: metadata.width, height: metadata.height },
        size: processedBuffer.length,
        mimetype: "image/png",
        uploadTime: new Date().toISOString(),
        url: `/api/images/${relPath.split("/").map(encodeURIComponent).join("/")}`,
        relPath,
        fullUrl: `${getBaseUrl(req)}/api/images/${relPath.split("/").map(encodeURIComponent).join("/")}`,
      };
      
      res.json({
        success: true,
        message: "图片处理成功",
        data: fileInfo,
      });
    } catch (error) {
      console.error("图片处理错误:", error);
      
      // 清理临时文件
      if (req.file && req.file.path) {
        try {
          await fs.remove(req.file.path);
        } catch (cleanupError) {
          console.error("清理临时文件失败:", cleanupError);
        }
      }
      
      res.status(500).json({ error: "图片处理失败" });
    }
  }
);

// SVG转PNG接口
app.post("/api/svg2png", requirePassword, async (req, res) => {
  try {
    const { svgCode } = req.body;
    if (!svgCode) {
      return res.status(400).json({ error: "缺少svgCode参数" });
    }
    // 转为png buffer
    const pngBuffer = await sharp(Buffer.from(svgCode)).png().toBuffer();
    res.set("Content-Type", "image/png");
    res.send(pngBuffer);
  } catch (err) {
    res.status(500).json({ error: "SVG转PNG失败", detail: err.message });
  }
});

// 路由回退处理 - 所有非API路由都返回Vue应用
app.get("*", (req, res) => {
  // 如果是API路由，不处理
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "API接口不存在" });
  }

  // 对于所有其他路由，返回Vue应用的index.html
  res.sendFile(path.join(__dirname, "../client-vue/dist/index.html"));
});
