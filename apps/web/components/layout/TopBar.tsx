import React from 'react';
import { TbMoon, TbMenu2, TbHome } from 'react-icons/tb';

type TopBarProps = {
  onToggleNight?: () => void;
  nightMode?: boolean;
  onProfileClick?: () => void;
};

export const TopBar: React.FC<TopBarProps> = ({ onToggleNight, nightMode = false, onProfileClick }) => {
  return (
    <nav className="topbar">
      <button className="logo-btn" onClick={() => (window.location.href = '/')}>
        <div className="logo-icon-sm">
          {/* Simplified SVG placeholder */}
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
        <button className="nav-tab active" id="tab-home"><TbHome className="ti" style={{fontSize: '13px', verticalAlign: '-2px', marginRight: '3px'}} />Home</button>
        <button className="nav-tab" id="tab-setup">New Job <span className="tab-badge">+</span></button>
        <button className="nav-tab" id="tab-generate">Generate</button>
        <button className="nav-tab" id="tab-review">Review</button>
        <button className="nav-tab" id="tab-deliver">Deliver</button>
        <button className="nav-tab" id="tab-history">Jobs</button>
      </div>
      <div className="topbar-right">
        <button className="night-btn" onClick={onToggleNight} id="night-btn">
          <TbMoon className="ti" id="night-icon" />
          <span className="hide-xs">Night</span>
        </button>
        <button className="user-btn" onClick={onProfileClick} id="user-avatar" title="Profile & settings">AG</button>
        <button className="hamburger" onClick={() => { const mobileNav = document.getElementById('mobile-nav'); if (mobileNav) mobileNav.classList.toggle('open'); }} aria-label="Menu"><TbMenu2 className="ti" /></button>
      </div>
    </nav>
  );
};
