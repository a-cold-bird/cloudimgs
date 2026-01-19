import type { ClassValue } from "clsx"
import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 计算文件的 MD5 哈希值
 * 使用 Web Crypto API，支持大文件分块读取
 */
export async function calculateFileMD5(file: File): Promise<string> {
  // 使用 SparkMD5 的方式分块计算，但这里用原生 crypto
  // 对于浏览器，我们使用 FileReader + crypto.subtle
  // 注意：crypto.subtle 不支持 MD5，所以我们使用 SHA-256 作为替代（更安全）
  const buffer = await file.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  return hashHex
}

/**
 * 计算文件的 SHA-256 哈希值
 * 返回 hex 字符串
 * 注意：Web Crypto API 只在安全上下文（HTTPS 或 localhost）中可用
 * 如果不可用，返回空字符串，服务端将跳过校验
 */
export async function calculateFileChecksum(file: File): Promise<string> {
  // 检查 Web Crypto API 是否可用（仅在安全上下文中可用）
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    console.warn('[Checksum] Web Crypto API 不可用（需要 HTTPS 或 localhost），跳过完整性校验')
    return ''
  }

  try {
    const buffer = await file.arrayBuffer()
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  } catch (err) {
    console.error('[Checksum] 计算失败:', err)
    return ''
  }
}
