import React, { memo } from 'react';
import { Checkbox, Tag } from 'antd';
import type { FanpageItem, PageCardItemProps } from '../types';
import { getAvatarGradient, getInitials, isDeadViaStatus } from '../utils';

export type { PageCardItemProps };

export const PageCardItem = memo<PageCardItemProps>(({
  page,
  isChecked,
  isAlreadyLiked,
  cleanName,
  avatarUrl,
  actorMode,
  selectedAccountId,
  onToggle,
}) => {
  return (
    <div
      onClick={() => onToggle(page.id)}
      className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 cursor-pointer transition-all active:scale-[0.99] ${
        isChecked
          ? 'border-blue-500/80 bg-blue-950/40 text-white shadow-sm shadow-blue-500/10'
          : 'border-slate-800 bg-slate-950/40 text-slate-300 hover:border-slate-700 hover:bg-slate-900/60'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className="relative w-7 h-7 shrink-0 rounded-lg overflow-hidden bg-slate-800 border border-slate-700/60 shadow-sm flex items-center justify-center">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={cleanName}
              loading="lazy"
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
                const fallback = (e.target as HTMLElement).nextElementSibling as HTMLElement;
                if (fallback) fallback.classList.remove('hidden');
              }}
            />
          ) : null}
          <div
            className={`w-full h-full text-on-accent font-semibold text-[10px] items-center justify-center ${
              actorMode === 'VIAS' ? 'bg-emerald-600' : getAvatarGradient(cleanName)
            } ${avatarUrl ? 'hidden' : 'flex'}`}
          >
            {getInitials(cleanName)}
          </div>
        </div>
        <div className="min-w-0">
          <div className="font-bold text-xs truncate max-w-[125px] sm:max-w-[135px]" title={cleanName}>
            {cleanName}
          </div>
          <div className="flex items-center gap-1 text-[10px] font-mono text-slate-400 truncate">
            <span>ID: {page.id}</span>
            {isAlreadyLiked && (
              <Tag color="orange" className="text-[9px] m-0 border-0 px-1 py-0 leading-tight">
                Đã like
              </Tag>
            )}
            {actorMode === 'VIAS' ? (
              <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/80 font-sans font-medium">
                Via
              </span>
            ) : (
              page.viaName && selectedAccountId === 'ALL_VIAS' && (
                <span className="text-[9px] px-1 py-0.2 rounded bg-blue-950/80 text-blue-300 border border-blue-800/80 font-sans font-medium">
                  {page.viaName}
                </span>
              )
            )}
            {isDeadViaStatus(page.viaStatus) ? (
              <span className="text-[9px] px-1.5 py-0.2 rounded bg-rose-950/90 text-rose-300 border border-rose-800/80 font-sans font-medium inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400" /> Cookie hết hạn
              </span>
            ) : page.viaStatus === 'OK' && selectedAccountId === 'ALL_VIAS' ? (
              <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-950/70 text-emerald-300 border border-emerald-800/60 font-sans font-medium inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Live
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <Checkbox
        checked={isChecked}
        onChange={(e) => {
          e.stopPropagation();
          onToggle(page.id);
        }}
      />
    </div>
  );
});

export default PageCardItem;
