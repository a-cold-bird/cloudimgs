import { createI18n } from 'vue-i18n'
import zh from './locales/zh'
import en from './locales/en'

// 获取用户偏好语言
function getDefaultLocale(): string {
    // 1. 检查 localStorage
    const stored = localStorage.getItem('locale')
    if (stored && ['zh', 'en'].includes(stored)) {
        return stored
    }

    // 2. 检查浏览器语言
    const browserLang = navigator.language.toLowerCase()
    if (browserLang.startsWith('zh')) {
        return 'zh'
    }

    // 3. 默认英文
    return 'en'
}

const i18n = createI18n({
    legacy: false, // 使用 Composition API 模式
    locale: getDefaultLocale(),
    fallbackLocale: 'en',
    messages: {
        zh,
        en
    }
})

export default i18n

// 切换语言的辅助函数
export function setLocale(locale: 'zh' | 'en') {
    i18n.global.locale.value = locale
    localStorage.setItem('locale', locale)
    document.documentElement.lang = locale
}

export function getCurrentLocale(): string {
    return i18n.global.locale.value
}
