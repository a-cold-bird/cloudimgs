export default {
    // 通用
    common: {
        loading: '加载中...',
        save: '保存',
        cancel: '取消',
        confirm: '确认',
        delete: '删除',
        edit: '编辑',
        close: '关闭',
        search: '搜索',
        upload: '上传',
        download: '下载',
        refresh: '刷新',
        selectAll: '全选',
        deselectAll: '取消选择',
        select: '选择',
        selected: '已选择 {count} 项',
        noData: '暂无数据',
        success: '成功',
        error: '错误',
        warning: '警告',
        info: '提示'
    },

    // Navigation
    nav: {
        gallery: '图库',
        albums: '相册',
        map: '地图',
        settings: '设置',
        dashboard: '仪表盘',
        albumManagement: '相册管理',
        tagManagement: '标签管理',
        mapMode: '地图模式',
        systemSettings: '系统设置',
        backToHome: '返回首页'
    },

    // 登录
    auth: {
        title: '登录',
        password: '密码',
        passwordPlaceholder: '请输入访问密码',
        login: '登录',
        logout: '退出登录',
        loginSuccess: '登录成功',
        loginFailed: '登录失败',
        wrongPassword: '密码错误',
        required: '请输入密码'
    },

    // 图库
    gallery: {
        title: '图库',
        recentUploads: '最近上传',
        searchPlaceholder: '搜索图片名称...',
        noImages: '未找到相关图片',
        clearSearch: '清除搜索条件',
        loadMore: '加载更多...',
        endOfList: '浏览完毕',
        deleteConfirm: '确定要删除选中的 {count} 张图片吗？',
        deleted: '已删除 {count} 张图片',
        uploadingFiles: '正在上传 {count} 个文件 ({progress}%)',
        cancelAllUploads: '取消所有上传',
        dropToUpload: '拖放文件到此处上传',
        toCurrentAlbum: '上传至当前相册'
    },

    // 图片详情
    imageDetail: {
        title: '详情',
        filename: '文件名',
        dimensions: '尺寸',
        size: '大小',
        date: '日期',
        tags: '标签',
        noTags: '暂无标签',
        addTag: '添加标签...',
        tagAdded: '标签已添加',
        tagRemoved: '标签已移除',
        tagRemoveFailed: '移除标签失败',
        deleteImage: '删除图片',
        confirmDelete: '点击确认删除',
        deleteWarning: '再次点击确认删除，3秒后自动取消',
        imageDeleted: '图片已删除',
        deleteFailed: '删除图片失败'
    },

    // 上传
    upload: {
        uploaded: '已上传 {filename}',
        failed: '上传失败: {filename}',
        cancelled: '已取消'
    },

    // 相册
    albums: {
        title: '相册管理',
        description: '管理您的图片集合',
        newAlbum: '新建相册',
        albumName: '相册名称',
        albumNamePlaceholder: '输入相册名称',
        create: '创建',
        noAlbums: '暂无相册，点击右上角创建',
        deleteConfirm: '确认删除相册？',
        deleteWarning: '您正在删除相册 "{name}"。此操作不可撤销，相册内的所有图片也将被永久删除。',
        items: '{count} 项'
    },

    // 地图
    map: {
        title: '地图模式',
        description: '在地图上查看带有 GPS 信息的照片',
        noGeoData: '暂无地理位置数据',
        noGeoDataDesc: '上传包含 GPS 信息的照片后，它们将显示在地图上。大多数手机拍摄的照片都包含位置信息。',
        photoLocations: '照片位置',
        photosWithLocation: '共 {count} 张照片包含地理位置信息',
        mapDeveloping: '地图功能开发中',
        mapIntegrationNeeded: '需要集成地图服务（如 Mapbox、Google Maps 或 OpenStreetMap）',
        unknownLocation: '位置未知',
        loadFailed: '加载地图数据失败'
    },

    // 设置
    settings: {
        title: '设置',
        description: '管理您的应用设置和偏好',
        appearance: '外观',
        appearanceDesc: '自定义应用的视觉外观',
        darkMode: '深色模式',
        darkModeDesc: '切换深色或浅色主题',
        lightMode: '浅色模式',
        language: '语言',
        languageDesc: '选择界面语言',
        chinese: '中文',
        english: 'English',
        cache: '缓存',
        cacheDesc: '管理本地缓存数据',
        clearCache: '清除缓存',
        cacheCleared: '缓存已清除',
        account: '账户',
        accountDesc: '管理您的登录状态'
    }
}
