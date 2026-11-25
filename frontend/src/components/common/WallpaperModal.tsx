import React, { useState, useRef } from 'react';
import { Modal, Tabs, Slider, Input, Button, Upload, message, Tooltip, Badge } from 'antd';
import {
  PictureOutlined,
  UploadOutlined,
  CheckCircleFilled,
  ReloadOutlined,
  EyeOutlined,
  SlidersOutlined,
  LinkOutlined,
  CheckOutlined,
} from '@ant-design/icons';
import {
  useWallpaper,
  WALLPAPER_PRESETS,
  WallpaperPreset,
} from '../../theme/WallpaperContext';

interface WallpaperModalProps {
  open: boolean;
  onClose: () => void;
}

export const WallpaperModal: React.FC<WallpaperModalProps> = ({ open, onClose }) => {
  const {
    config,
    currentPreset,
    activeUrl,
    setPreset,
    setCustomUrl,
    setOverlayOpacity,
    setBlurAmount,
    uploadCustomImage,
    resetToDefault,
  } = useWallpaper();

  const [inputUrl, setInputUrl] = useState('');
  const [activeTab, setActiveTab] = useState<'presets' | 'custom' | 'settings'>('presets');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleApplyCustomUrl = () => {
    if (!inputUrl.trim()) {
      message.warning('Please paste a valid image link');
      return;
    }
    setCustomUrl(inputUrl.trim());
    message.success('Custom wallpaper applied!');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      message.error('Please choose an image file (.jpg, .png, .webp)');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      message.error('Maximum image size is 10MB');
      return;
    }

    try {
      await uploadCustomImage(file);
      message.success('Wallpaper uploaded from your computer!');
    } catch {
      message.error('Could not read the image file, please try again');
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={780}
      centered
      title={
        <div className="flex items-center gap-2.5 pb-1">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-md shadow-blue-500/30">
            <PictureOutlined className="text-base" />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-100 flex items-center gap-2">
              Wallpaper Gallery & Frosted Glass Effects
              <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                PhuSocial Edition
              </span>
            </div>
            <div className="text-[11px] text-slate-400 font-normal">
              Change the background image and frosted glass (Glassmorphism) blur to suit your style
            </div>
          </div>
        </div>
      }
      className="wallpaper-modal"
    >
      <div className="space-y-4 pt-2">
        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-800 gap-2 pb-2">
          <button
            onClick={() => setActiveTab('presets')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === 'presets'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <PictureOutlined />
            <span>Preset Gallery ({WALLPAPER_PRESETS.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('custom')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === 'custom'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <UploadOutlined />
            <span>Upload Your Own / Online Link</span>
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === 'settings'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <SlidersOutlined />
            <span>Darkness & Blur</span>
          </button>
        </div>

        {/* Tab 1: Presets Grid */}
        {activeTab === 'presets' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[380px] overflow-y-auto pr-1">
              {WALLPAPER_PRESETS.map((preset) => {
                const isSelected = config.wallpaperId === preset.id;
                return (
                  <div
                    key={preset.id}
                    onClick={() => setPreset(preset.id)}
                    className={`group relative rounded-xl overflow-hidden border-2 cursor-pointer transition-all duration-200 hover:scale-[1.02] flex flex-col ${
                      isSelected
                        ? 'border-blue-500 ring-2 ring-blue-500/30 shadow-lg shadow-blue-500/20'
                        : 'border-slate-800/80 hover:border-slate-600 bg-slate-900/60'
                    }`}
                  >
                    {/* Thumbnail Image */}
                    <div className="h-24 sm:h-28 w-full bg-slate-950 relative overflow-hidden">
                      {preset.url ? (
                        <img
                          src={preset.thumbnail}
                          alt={preset.name}
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-slate-950 text-slate-500 p-2 text-center">
                          <div className="w-7 h-7 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center mb-1">
                            ⬛
                          </div>
                          <span className="text-[10px] font-mono">Pure Black Mode</span>
                        </div>
                      )}

                      {/* Selected Badge */}
                      {isSelected && (
                        <div className="absolute top-2 right-2 bg-blue-600 text-white rounded-full p-1 shadow-md flex items-center justify-center">
                          <CheckOutlined className="text-xs" />
                        </div>
                      )}

                      {preset.id === 'alpine-mist' && (
                        <div className="absolute bottom-2 left-2 bg-indigo-950/90 border border-indigo-700/60 text-indigo-300 text-[9px] font-bold px-1.5 py-0.5 rounded">
                          ★ Standard Preset
                        </div>
                      )}
                    </div>

                    {/* Meta info */}
                    <div className="p-2.5 bg-slate-900/90 flex-1 flex flex-col justify-between border-t border-slate-800/60">
                      <div>
                        <div className="text-xs font-bold text-slate-200 truncate group-hover:text-blue-400 transition-colors">
                          {preset.name}
                        </div>
                        <div className="text-[10px] text-slate-400 line-clamp-1 mt-0.5">
                          {preset.description}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tab 2: Custom URL / Upload */}
        {activeTab === 'custom' && (
          <div className="space-y-4 py-1">
            {/* Box 1: File Upload from Computer */}
            <div className="p-4 rounded-xl border border-dashed border-slate-700 bg-slate-900/50 hover:bg-slate-900/80 transition-colors text-center">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept="image/*"
                className="hidden"
              />
              <div className="w-12 h-12 mx-auto rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center mb-2">
                <UploadOutlined className="text-xl" />
              </div>
              <div className="text-xs font-bold text-slate-200">
                Upload an image from your computer
              </div>
              <div className="text-[11px] text-slate-400 mt-1 max-w-sm mx-auto">
                Supports PNG, JPG, WEBP up to 10MB. The image is stored locally in your browser.
              </div>
              <Button
                type="primary"
                onClick={() => fileInputRef.current?.click()}
                icon={<UploadOutlined />}
                className="mt-3 bg-blue-600 hover:bg-blue-500 text-xs font-semibold rounded-lg h-8"
              >
                Choose image
              </Button>
            </div>

            {/* Box 2: Direct Image URL */}
            <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50 space-y-2">
              <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <LinkOutlined className="text-blue-400" />
                Paste an online image link (URL)
              </div>
              <div className="text-[11px] text-slate-400">
                Enter an image link from Unsplash, Pexels, Imgur, Google Drive (direct link) or any website:
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="https://images.unsplash.com/..."
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                  className="text-xs !bg-slate-950 !border-slate-800"
                />
                <Button
                  type="primary"
                  onClick={handleApplyCustomUrl}
                  className="bg-blue-600 hover:bg-blue-500 text-xs font-semibold rounded-lg shrink-0"
                >
                  Apply
                </Button>
              </div>
            </div>

            {/* Current Custom Preview */}
            {config.wallpaperId === 'custom' && config.customUrl && (
              <div className="p-3 rounded-xl border border-blue-500/30 bg-blue-950/20 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <img
                    src={config.customUrl}
                    alt="Custom preview"
                    className="w-16 h-10 object-cover rounded-lg border border-slate-700"
                  />
                  <div>
                    <div className="text-xs font-bold text-blue-300">Using a custom wallpaper</div>
                    <div className="text-[10px] text-slate-400">Saved in browser settings</div>
                  </div>
                </div>
                <Button
                  size="small"
                  onClick={() => setPreset('alpine-mist')}
                  className="text-xs border-slate-700 text-slate-300"
                >
                  Remove
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Sliders for Overlay & Blur */}
        {activeTab === 'settings' && (
          <div className="space-y-4 py-2">
            {/* Slider 1: Overlay Darkness */}
            <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-200">
                    Text-protection overlay darkness (Overlay Darkness)
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Drag right for a darker background (crisper text), drag left to see the image more clearly.
                  </div>
                </div>
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  {Math.round(config.overlayOpacity * 100)}%
                </span>
              </div>
              <Slider
                min={0.25}
                max={0.9}
                step={0.05}
                value={config.overlayOpacity}
                onChange={setOverlayOpacity}
                tooltip={{ formatter: (val) => `${Math.round((val || 0) * 100)}%` }}
              />
              <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                <span>25% (Clear view)</span>
                <span>65% (Recommended)</span>
                <span>90% (Almost black)</span>
              </div>
            </div>

            {/* Slider 2: Backdrop Blur */}
            <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-200">
                    Background blur (Backdrop Blur Effect)
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Blurs the scenery behind (Bokeh), adding depth to the panels.
                  </div>
                </div>
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                  {config.blurAmount}px
                </span>
              </div>
              <Slider
                min={0}
                max={16}
                step={1}
                value={config.blurAmount}
                onChange={setBlurAmount}
                tooltip={{ formatter: (val) => `${val}px` }}
              />
              <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                <span>0px (Original sharpness)</span>
                <span>4px (Subtle blur)</span>
                <span>16px (Strong blur)</span>
              </div>
            </div>
          </div>
        )}

        {/* Modal Bottom Controls */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-800/80">
          <Button
            type="text"
            icon={<ReloadOutlined />}
            onClick={() => {
              resetToDefault();
              message.info('Default wallpaper settings restored');
            }}
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            Reset to default
          </Button>

          <Button
            type="primary"
            onClick={onClose}
            className="bg-blue-600 hover:bg-blue-500 text-xs font-semibold px-5 rounded-lg h-8 shadow-md shadow-blue-600/30"
          >
            Close & Save
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default WallpaperModal;
