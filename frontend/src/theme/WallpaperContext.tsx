import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';

export interface WallpaperPreset {
  id: string;
  name: string;
  description: string;
  url: string;
  thumbnail: string;
  category: 'nature' | 'space' | 'cyber' | 'minimal';
}

export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  {
    id: 'alpine-mist',
    name: 'Pine Forest & Misty Mountains',
    description: 'Misty mountain range & calm pine forest (PhuSocial standard)',
    url: '/wallpapers/alpine-mist.jpg',
    thumbnail: '/wallpapers/alpine-mist.jpg',
    category: 'nature',
  },
  {
    id: 'misty-forest',
    name: 'Misty Night Forest',
    description: 'Towering pines wrapped in drifting mist',
    url: '/wallpapers/misty-forest.jpg',
    thumbnail: '/wallpapers/misty-forest.jpg',
    category: 'nature',
  },
  {
    id: 'yosemite-valley',
    name: 'Majestic Rock Valley',
    description: 'Granite cliffs rising over the vast Yosemite valley',
    url: '/wallpapers/yosemite-valley.jpg',
    thumbnail: '/wallpapers/yosemite-valley.jpg',
    category: 'nature',
  },
  {
    id: 'starry-mountain',
    name: 'Peak & Milky Way',
    description: 'A snowy peak under millions of stars',
    url: '/wallpapers/starry-mountain.jpg',
    thumbnail: '/wallpapers/starry-mountain.jpg',
    category: 'space',
  },
  {
    id: 'nordic-aurora',
    name: 'Northern Lights',
    description: 'Emerald ribbons dancing over a snowy night sky',
    url: '/wallpapers/nordic-aurora.jpg',
    thumbnail: '/wallpapers/nordic-aurora.jpg',
    category: 'nature',
  },
  {
    id: 'cyber-city',
    name: 'Cyberpunk Midnight City',
    description: 'Bright neon lights on a futuristic skyline',
    url: '/wallpapers/cyber-city.jpg',
    thumbnail: '/wallpapers/cyber-city.jpg',
    category: 'cyber',
  },
  {
    id: 'solid-stealth',
    name: 'Obsidian Stealth Dark',
    description: 'Premium minimal matte black, no background image',
    url: '',
    thumbnail: '',
    category: 'minimal',
  },
];

export interface WallpaperConfig {
  wallpaperId: string;
  customUrl?: string;
  overlayOpacity: number; // 0.3 - 0.9
  blurAmount: number; // 0 - 16px
}

const STORAGE_KEY = 'viplike_wallpaper_config_v2';

const DEFAULT_CONFIG: WallpaperConfig = {
  wallpaperId: 'alpine-mist',
  overlayOpacity: 0.65,
  blurAmount: 0,
};

interface WallpaperContextType {
  config: WallpaperConfig;
  currentPreset?: WallpaperPreset;
  activeUrl: string;
  setPreset: (id: string) => void;
  setCustomUrl: (url: string) => void;
  setOverlayOpacity: (opacity: number) => void;
  setBlurAmount: (blur: number) => void;
  uploadCustomImage: (file: File) => Promise<void>;
  resetToDefault: () => void;
}

const WallpaperContext = createContext<WallpaperContextType | undefined>(undefined);

export const WallpaperProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<WallpaperConfig>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.warn('Failed to read wallpaper config from localStorage:', e);
    }
    return DEFAULT_CONFIG;
  });

  // Save to localStorage when the config changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (e) {
      console.warn('Failed to save wallpaper config to localStorage:', e);
    }
  }, [config]);

  const currentPreset = useMemo(() => {
    return WALLPAPER_PRESETS.find((p) => p.id === config.wallpaperId);
  }, [config.wallpaperId]);

  const activeUrl = useMemo(() => {
    if (config.wallpaperId === 'custom' && config.customUrl) {
      return config.customUrl;
    }
    if (config.wallpaperId === 'solid-stealth') {
      return '';
    }
    return currentPreset?.url || '/wallpapers/alpine-mist.jpg';
  }, [config.wallpaperId, config.customUrl, currentPreset]);

  const setPreset = useCallback((id: string) => {
    setConfig((prev) => ({ ...prev, wallpaperId: id }));
  }, []);

  const setCustomUrl = useCallback((url: string) => {
    setConfig((prev) => ({
      ...prev,
      wallpaperId: 'custom',
      customUrl: url,
    }));
  }, []);

  const setOverlayOpacity = useCallback((overlayOpacity: number) => {
    setConfig((prev) => ({ ...prev, overlayOpacity }));
  }, []);

  const setBlurAmount = useCallback((blurAmount: number) => {
    setConfig((prev) => ({ ...prev, blurAmount }));
  }, []);

  const uploadCustomImage = useCallback(async (file: File): Promise<void> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result as string;
        setConfig((prev) => ({
          ...prev,
          wallpaperId: 'custom',
          customUrl: base64,
        }));
        resolve();
      };
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(file);
    });
  }, []);

  const resetToDefault = useCallback(() => {
    setConfig(DEFAULT_CONFIG);
  }, []);

  return (
    <WallpaperContext.Provider
      value={{
        config,
        currentPreset,
        activeUrl,
        setPreset,
        setCustomUrl,
        setOverlayOpacity,
        setBlurAmount,
        uploadCustomImage,
        resetToDefault,
      }}
    >
      {/* Background Wallpaper Container */}
      <div
        className="fixed inset-0 pointer-events-none z-0 transition-opacity duration-700 ease-in-out"
        style={{
          backgroundColor: '#070b13',
          backgroundImage: activeUrl ? `url("${activeUrl}")` : 'none',
          backgroundSize: 'cover',
          backgroundPosition: 'center center',
          backgroundAttachment: 'fixed',
          filter: config.blurAmount > 0 ? `blur(${config.blurAmount}px)` : 'none',
          transform: config.blurAmount > 0 ? 'scale(1.03)' : 'none', // avoid white edges when blurred
        }}
      />

      {/* Dark vignette & contrast overlay to keep text and tables crisp */}
      <div
        className="fixed inset-0 pointer-events-none z-0 transition-all duration-300"
        style={{
          backgroundColor: `rgba(7, 11, 20, ${config.overlayOpacity})`,
          backgroundImage: `radial-gradient(ellipse at 50% 10%, rgba(15, 23, 42, ${Math.max(0.2, config.overlayOpacity - 0.2)}) 0%, rgba(4, 7, 14, ${Math.min(0.95, config.overlayOpacity + 0.15)}) 100%)`,
        }}
      />

      {/* UI Content Layer */}
      <div className="relative z-10 min-h-screen">
        {children}
      </div>
    </WallpaperContext.Provider>
  );
};

export const useWallpaper = (): WallpaperContextType => {
  const context = useContext(WallpaperContext);
  if (!context) {
    throw new Error('useWallpaper must be used within a WallpaperProvider');
  }
  return context;
};
