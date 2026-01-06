export default {
    // Common
    common: {
        loading: 'Loading...',
        save: 'Save',
        cancel: 'Cancel',
        confirm: 'Confirm',
        delete: 'Delete',
        edit: 'Edit',
        close: 'Close',
        search: 'Search',
        upload: 'Upload',
        download: 'Download',
        refresh: 'Refresh',
        selectAll: 'Select All',
        deselectAll: 'Deselect',
        select: 'Select',
        selected: '{count} selected',
        noData: 'No data',
        success: 'Success',
        error: 'Error',
        warning: 'Warning',
        info: 'Info'
    },

    // Navigation
    nav: {
        gallery: 'Gallery',
        albums: 'Albums',
        map: 'Map',
        settings: 'Settings',
        dashboard: 'Dashboard',
        albumManagement: 'Album Management',
        tagManagement: 'Tag Management',
        mapMode: 'Map Mode',
        systemSettings: 'System Settings',
        backToHome: 'Back to Home'
    },

    // Authentication
    auth: {
        title: 'Login',
        password: 'Password',
        passwordPlaceholder: 'Enter access password',
        login: 'Login',
        logout: 'Logout',
        loginSuccess: 'Login successful',
        loginFailed: 'Login failed',
        wrongPassword: 'Wrong password',
        required: 'Password is required'
    },

    // Gallery
    gallery: {
        title: 'Gallery',
        recentUploads: 'Recent Uploads',
        searchPlaceholder: 'Search images...',
        noImages: 'No images found',
        clearSearch: 'Clear search',
        loadMore: 'Loading more...',
        endOfList: 'End of list',
        deleteConfirm: 'Are you sure you want to delete {count} images?',
        deleted: 'Deleted {count} images',
        uploadingFiles: 'Uploading {count} files ({progress}%)',
        cancelAllUploads: 'Cancel all uploads',
        dropToUpload: 'Drop files to upload',
        toCurrentAlbum: 'to current album'
    },

    // Image Detail
    imageDetail: {
        title: 'Details',
        filename: 'Filename',
        dimensions: 'Dimensions',
        size: 'Size',
        date: 'Date',
        tags: 'Tags',
        noTags: 'No tags',
        addTag: 'Add tag...',
        tagAdded: 'Tag added',
        tagRemoved: 'Tag removed',
        tagRemoveFailed: 'Failed to remove tag',
        deleteImage: 'Delete Image',
        confirmDelete: 'Click to confirm',
        deleteWarning: 'Click again to confirm, auto-cancel in 3s',
        imageDeleted: 'Image deleted',
        deleteFailed: 'Failed to delete image'
    },

    // Upload
    upload: {
        uploaded: 'Uploaded {filename}',
        failed: 'Upload failed: {filename}',
        cancelled: 'Cancelled'
    },

    // Albums
    albums: {
        title: 'Album Management',
        description: 'Manage your image collections',
        newAlbum: 'New Album',
        albumName: 'Album Name',
        albumNamePlaceholder: 'Enter album name',
        create: 'Create',
        noAlbums: 'No albums yet, click to create',
        deleteConfirm: 'Delete Album?',
        deleteWarning: 'You are deleting album "{name}". This action cannot be undone, and all images in the album will be permanently deleted.',
        items: '{count} items'
    },

    // Map
    map: {
        title: 'Map Mode',
        description: 'View photos with GPS information on the map',
        noGeoData: 'No location data',
        noGeoDataDesc: 'Photos with GPS information will appear on the map. Most smartphone photos include location data.',
        photoLocations: 'Photo Locations',
        photosWithLocation: '{count} photos with location data',
        mapDeveloping: 'Map feature in development',
        mapIntegrationNeeded: 'Map service integration required (Mapbox, Google Maps, or OpenStreetMap)',
        unknownLocation: 'Unknown location',
        loadFailed: 'Failed to load map data'
    },

    // Settings
    settings: {
        title: 'Settings',
        description: 'Manage your app settings and preferences',
        appearance: 'Appearance',
        appearanceDesc: 'Customize the visual appearance',
        darkMode: 'Dark Mode',
        darkModeDesc: 'Toggle dark or light theme',
        lightMode: 'Light Mode',
        language: 'Language',
        languageDesc: 'Select interface language',
        chinese: '中文',
        english: 'English',
        cache: 'Cache',
        cacheDesc: 'Manage local cache data',
        clearCache: 'Clear Cache',
        cacheCleared: 'Cache cleared',
        account: 'Account',
        accountDesc: 'Manage your login status'
    }
}
