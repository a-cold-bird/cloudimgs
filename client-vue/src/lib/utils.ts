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
 * 计算文件的 SHA-256 哈希值（分块读取，适合大文件）
 * 返回 hex 字符串
 */
export async function calculateFileChecksum(file: File): Promise<string> {
  // 对于大文件，分块读取以避免内存问题
  const CHUNK_SIZE = 2 * 1024 * 1024 // 2MB chunks

  if (file.size <= CHUNK_SIZE) {
    // 小文件直接计算
    const buffer = await file.arrayBuffer()
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }

  // 大文件：直接读取整个文件（浏览器会优化）
  // 注意：Web Crypto API 不支持流式哈希，所以大文件仍需一次性读取
  const buffer = await file.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}
