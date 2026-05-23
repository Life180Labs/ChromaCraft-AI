import React from 'react';
import { TbMoon, TbMenu2, TbHome } from 'react-icons/tb';
import type { TabId } from '../shared/types';

type TopBarProps = {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  onToggleNight?: () => void;
  nightMode?: boolean;
  onProfileClick?: () => void;
  userInitials?: string;
};

const navTabs: { id: TabId; label: string; icon?: boolean }[] = [
  { id: 'home', label: 'Home', icon: true },
  { id: 'setup', label: 'New Job' },
  { id: 'generate', label: 'Generate' },
  { id: 'review', label: 'Review' },
  { id: 'deliver', label: 'Deliver' },
  { id: 'history', label: 'Jobs' },
];

export const TopBar: React.FC<TopBarProps> = ({ activeTab, onTabChange, onToggleNight, nightMode = false, onProfileClick, userInitials = 'AG' }) => {
  return (
    <nav className="topbar">
      <button className="logo-btn" onClick={() => onTabChange('home')}>
        <div className="logo-icon-sm">
          <svg viewBox="0 0 16 16" fill="none">
            <rect x="1" y="3" width="14" height="10" rx="2" stroke="var(--acc)" strokeWidth="1.2" />
            <rect x="2.5" y="5" width="3" height="6" rx="1" fill="var(--acc)" opacity=".9" />
            <rect x="6.5" y="5" width="3" height="6" rx="1" fill="var(--acc)" opacity=".65" />
            <rect x="10.5" y="5" width="3" height="6" rx="1" fill="var(--acc)" opacity=".4" />
          </svg>
        </div>
        <div>
          <div className="logo-text-sm">Chroma<span>Craft</span></div>
          <div className="logo-by-sm">by Life180 Labs</div>
        </div>
      </button>
      <div className="nav-links" id="nav-links">
        {navTabs.map((t) => (
          <button
            key={t.id}
            className={`nav-tab ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => onTabChange(t.id)}
          >
            {t.icon && <TbHome className="ti" style={{ fontSize: '13px', verticalAlign: '-2px', marginRight: '3px' }} />}
            {t.label}
            {t.id === 'setup' && <span className="tab-badge">+</span>}
          </button>
        ))}
      </div>
      <div className="topbar-right">
        <button className="night-btn" onClick={onToggleNight} id="night-btn">
          <TbMoon className="ti" id="night-icon" />
          <span className="hide-xs">Night</span>
        </button>
        <button className="user-btn" onClick={onProfileClick} id="user-avatar" title="Profile & settings">{userInitials}</button>
        <button className="hamburger" onClick={() => { const mobileNav = document.getElementById('mobile-nav'); if (mobileNav) mobileNav.classList.toggle('open'); }} aria-label="Menu"><TbMenu2 className="ti" /></button>
      </div>
    </nav>
  );
};
