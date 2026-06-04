'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { TbKey, TbLogout, TbCheck, TbEye, TbEyeOff, TbBrandGoogle, TbVideo } from 'react-icons/tb';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import type { Provider } from '../shared/types';

// ─── Model Options ────────────────────────────────────────────────────────────
const GEMINI_IMAGE_MODELS = [
  {
    value: 'gemini-3.5-flash',
    label: 'Gemini 3.5 Flash',
    description: 'The most capable model for sustained frontier performance on agentic and coding tasks, balancing high intelligence with speed.',
  },
  {
    value: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro Preview',
    description: 'The advanced thinking model, built for complex problem-solving, deep reasoning, and heavy analytical tasks.',
  },
  {
    value: 'gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash Lite',
    description: 'An ultra-fast, cost-efficient model optimized for high-volume, low-latency tasks.',
  },
  {
    value: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    description: 'A highly capable previous-generation model for deep reasoning and coding.',
  },
  {
    value: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    description: 'The best price-performance model of the 2.5 series for low-latency reasoning tasks.',
  },
  {
    value: 'gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash Lite',
    description: 'The fastest and most budget-friendly multimodal option in the 2.5 family.',
  },
  {
    value: 'gemini-2.0-flash',
    label: 'Gemini 2.0 Flash',
    description: 'The next-generation production model, delivering lightning-fast speeds and high-fidelity multimodal image outputs.',
  },
  {
    value: 'gemini-3-pro-image',
    label: 'Gemini 3 Pro Image (Recommended)',
    description: 'The latest Gemini image model for state-of-the-art generation.',
  },
  {
    value: 'gemini-2.0-flash-preview-image-generation',
    label: 'Gemini 2.0 Flash (Image Gen Preview)',
    description: 'Preview model with native inline image generation capabilities.',
  },
];

const GEMINI_VIDEO_MODELS = [
  { value: 'veo-3.1-generate-001', label: 'Veo 3.1' },
  { value: 'veo-3.1-generate-preview', label: 'Veo 3.1 Preview' },
  { value: 'veo-3.0-generate-001', label: 'Veo 3.0' },
  { value: 'veo-3.0-generate-preview', label: 'Veo 3.0 Preview' },
  { value: 'veo-2.0-generate-001', label: 'Veo 2.0' },
  { value: 'veo-2.0-generate-preview', label: 'Veo 2.0 Preview' },
];

type ProviderKeyConfig = {
  name: string;
  label: string;
  description: string;
  placeholder: string;
  optional?: boolean;
};

const PROVIDER_KEY_CONFIGS: ProviderKeyConfig[] = [
  {
    name: 'openai',
    label: 'OpenAI (DALL·E 3)',
    description: 'Used for catalog color variants and lifestyle scenes',
    placeholder: 'sk-...',
  },
  {
    name: 'stability',
    label: 'Stability AI',
    description: 'Stable Diffusion XL text-to-image generation',
    placeholder: 'sk-...',
  },
  {
    name: 'groq',
    label: 'Groq Cloud',
    description: 'Ultra-fast Llama-3 inference provider for prompts',
    placeholder: 'gsk-...',
  },
  {
    name: 'gemini',
    label: 'Google Gemini',
    description: 'Google Gemini Image Generation API (used for concurrent generation)',
    placeholder: 'AIzaSy...',
  },
  {
    name: 'mock',
    label: 'Mock provider',
    description: 'Local placeholders — no API key required',
    placeholder: 'not-required',
    optional: true,
  },
];

type ProfileSettingsProps = {
  userName: string;
  userEmail: string;
  userInitials: string;
  nightMode: boolean;
  onToggleNight: () => void;
  onSignOut: () => void;
  onProvidersUpdated?: () => void;
  onProfileUpdated?: (newName: string) => void;
};

export const ProfileSettings: React.FC<ProfileSettingsProps> = ({
  userName,
  userEmail,
  userInitials,
  nightMode,
  onToggleNight,
  onSignOut,
  onProvidersUpdated,
  onProfileUpdated,
}) => {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [defaultProvider, setDefaultProvider] = useState<string>('');
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editedName, setEditedName] = useState(userName);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);

  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState<string | null>(null);

  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [toggling2FA, setToggling2FA] = useState(false);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  // Model settings
  const [geminiImageModel, setGeminiImageModel] = useState('gemini-3-pro-image');
  const [geminiVideoModel, setGeminiVideoModel] = useState('veo-3.1-generate-preview');
  const [savingModels, setSavingModels] = useState(false);
  const [modelSaveMessage, setModelSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    setEditedName(userName);
  }, [userName]);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await fetch('/api/v1/auth/profile');
        if (res.ok) {
          const data = await res.json();
          if (data.user) {
            setTwoFactorEnabled(data.user.twoFactorEnabled);
          }
        }
      } catch (err) {
        console.error('Failed to load profile settings:', err);
      }
    };
    fetchProfile();

    // Fetch model settings
    const fetchModelSettings = async () => {
      try {
        const res = await fetch('/api/v1/settings');
        if (res.ok) {
          const data = await res.json();
          if (data.geminiImageModel) setGeminiImageModel(data.geminiImageModel);
          if (data.geminiVideoModel) setGeminiVideoModel(data.geminiVideoModel);
        }
      } catch (err) {
        console.error('Failed to load model settings:', err);
      }
    };
    fetchModelSettings();
  }, []);

  const handleSaveModels = async () => {
    setSavingModels(true);
    setModelSaveMessage(null);
    try {
      const res = await fetch('/api/v1/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geminiImageModel, geminiVideoModel }),
      });
      if (res.ok) {
        setModelSaveMessage('Model preferences saved successfully.');
      } else {
        const err = await res.json();
        setModelSaveMessage(err.error || 'Failed to save model settings.');
      }
    } catch {
      setModelSaveMessage('Failed to save model settings.');
    } finally {
      setSavingModels(false);
    }
  };


  const handleSaveProfile = async () => {
    setProfileError(null);
    setProfileSuccess(null);
    try {
      const res = await fetch('/api/v1/auth/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editedName }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to update profile');
      }
      setProfileSuccess('Profile updated successfully.');
      setIsEditingProfile(false);
      onProfileUpdated?.(editedName);
    } catch (err: any) {
      setProfileError(err.message);
    }
  };

  const handleSavePassword = async () => {
    setPwError(null);
    setPwSuccess(null);
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPwError('Please fill out all password fields');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('Passwords do not match');
      return;
    }
    try {
      const res = await fetch('/api/v1/auth/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to change password');
      }
      setPwSuccess('Password changed successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setIsChangingPassword(false);
    } catch (err: any) {
      setPwError(err.message);
    }
  };

  const handleToggle2FA = async () => {
    setToggling2FA(true);
    const newValue = !twoFactorEnabled;
    try {
      const res = await fetch('/api/v1/auth/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ twoFactorEnabled: newValue }),
      });
      if (res.ok) {
        setTwoFactorEnabled(newValue);
        setSaveMessage(`2-Step Verification ${newValue ? 'enabled' : 'disabled'}.`);
      } else {
        throw new Error('Failed to update 2-step verification settings');
      }
    } catch (err: any) {
      setSaveMessage(err.message);
    } finally {
      setToggling2FA(false);
    }
  };

  const toggleShowKey = (name: string) => {
    setShowKeys((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/providers');
      if (!res.ok) throw new Error('Failed to load providers');
      const data: Provider[] = await res.json();
      setProviders(data);
      const currentDefault = data.find((p) => p.default);
      if (currentDefault) setDefaultProvider(currentDefault.name.toLowerCase());
      setLoadError(null);
    } catch {
      setLoadError('Could not load provider settings.');
    }
  }, []);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  const providerHasKey = (name: string) =>
    providers.some((p) => p.name.toLowerCase() === name.toLowerCase() && p.hasApiKey);

  const handleSaveProvider = async (config: ProviderKeyConfig) => {
    const key = apiKeys[config.name]?.trim();
    const hasExisting = providerHasKey(config.name);

    if (!config.optional && !key && !hasExisting) {
      setSaveMessage(`Enter an API key for ${config.label}.`);
      return;
    }

    setSavingProvider(config.name);
    setSaveMessage(null);

    try {
      const res = await fetch('/api/v1/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: config.name,
          apiKey: key || (hasExisting ? 'unchanged' : config.optional ? 'mock' : key),
          isDefault: defaultProvider === config.name,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Save failed');
      }

      setApiKeys((prev) => ({ ...prev, [config.name]: '' }));
      await fetchProviders();
      onProvidersUpdated?.();
      setSaveMessage(`${config.label} saved.`);
    } catch (err: unknown) {
      setSaveMessage(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingProvider(null);
    }
  };

  const handleSetDefault = async (name: string) => {
    setDefaultProvider(name);
    const existing = providers.find((p) => p.name.toLowerCase() === name);
    if (!existing?.hasApiKey && name !== 'mock') {
      setSaveMessage(`Save an API key for ${name} before setting it as default.`);
      return;
    }

    try {
      const res = await fetch('/api/v1/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          apiKey: name === 'mock' ? 'mock' : 'unchanged',
          isDefault: true,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Could not update default provider');
      }

      await fetchProviders();
      onProvidersUpdated?.();
      setSaveMessage('Default provider updated.');
    } catch (err: unknown) {
      setSaveMessage(err instanceof Error ? err.message : 'Update failed');
    }
  };

  return (
    <div className="screen active">
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div className="profile-avatar">{userInitials}</div>
          <div style={{ flex: 1 }}>
            {isEditingProfile ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                <Input
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  placeholder="Enter name"
                  style={{ maxWidth: 300 }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="primary" size="sm" onClick={handleSaveProfile}>Save</Button>
                  <Button variant="outline" size="sm" onClick={() => { setIsEditingProfile(false); setEditedName(userName); }}>Cancel</Button>
                </div>
                {profileError && <span style={{ fontSize: 12, color: 'var(--err)', marginTop: 2 }}>{profileError}</span>}
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 18, fontWeight: 500, color: 'var(--tx)' }}>
                    {userName}
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsEditingProfile(true)}
                    style={{ background: 'none', border: 'none', color: 'var(--acc)', cursor: 'pointer', fontSize: 12, textDecoration: 'underline' }}
                  >
                    Edit Profile
                  </button>
                </div>
                {profileSuccess && <div style={{ fontSize: 12, color: 'green', marginTop: 4 }}>{profileSuccess}</div>}
              </>
            )}
            <div style={{ fontSize: 12, color: 'var(--tx3)', marginTop: 2 }}>{userEmail} · Life180 Labs</div>
            <div style={{ marginTop: 8 }}>
              <span className="badge b-gray">Free plan</span>
            </div>
          </div>
        </div>
      </div>

      <div className="sec">Account settings</div>
      <div className="card">
        <div className="settings-row">
          <div>
            <div className="settings-label">Email address</div>
            <div className="settings-desc">{userEmail}</div>
          </div>
        </div>
        <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div className="settings-label">Password</div>
              <div className="settings-desc">Change your account password</div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setIsChangingPassword(!isChangingPassword)}>
              {isChangingPassword ? 'Cancel' : 'Change password'}
            </Button>
          </div>
          
          {isChangingPassword && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="settings-label" style={{ fontSize: 12, marginBottom: 4 }}>Current Password</label>
                <Input
                  type="password"
                  placeholder="Enter current password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="settings-label" style={{ fontSize: 12, marginBottom: 4 }}>New Password</label>
                <Input
                  type="password"
                  placeholder="Enter new password (min 6 chars)"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="settings-label" style={{ fontSize: 12, marginBottom: 4 }}>Confirm New Password</label>
                <Input
                  type="password"
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              {pwError && <div style={{ fontSize: 12, color: 'var(--err)', marginTop: 2 }}>{pwError}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <Button variant="primary" size="sm" onClick={handleSavePassword}>Save password</Button>
              </div>
            </div>
          )}
          {pwSuccess && <div style={{ fontSize: 12, color: 'green', marginTop: 8 }}>{pwSuccess}</div>}
        </div>
      </div>

      <div className="sec">Security settings</div>
      <div className="card">
        <div className="settings-row">
          <div>
            <div className="settings-label">2-Step Verification</div>
            <div className="settings-desc">Add an extra layer of security to your account</div>
          </div>
          <button
            type="button"
            className={`toggle ${twoFactorEnabled ? 'on' : 'off'}`}
            disabled={toggling2FA}
            onClick={handleToggle2FA}
            aria-label="Toggle 2-step verification"
          />
        </div>
      </div>

      <div className="sec">Preferences</div>
      <div className="card">
        <div className="settings-row">
          <div>
            <div className="settings-label">Dark / night mode</div>
            <div className="settings-desc">Switch to dark theme</div>
          </div>
          <button
            type="button"
            className={`toggle ${nightMode ? 'on' : 'off'}`}
            onClick={onToggleNight}
            aria-label="Toggle night mode"
          />
        </div>
      </div>

      <div className="sec">AI provider API keys</div>
      <div className="card">
        <p style={{ fontSize: 12, color: 'var(--tx3)', marginBottom: 14 }}>
          Keys are stored securely on the server and used by the generation worker. Leave a field blank to keep an existing key.
        </p>

        {loadError && <div className="notice err" style={{ marginBottom: 12 }}>{loadError}</div>}

        {PROVIDER_KEY_CONFIGS.map((config) => (
          <div key={config.name} className="api-key-field">
            <label htmlFor={`api-key-${config.name}`}>
              <TbKey style={{ verticalAlign: -2, marginRight: 4 }} />
              {config.label}
            </label>
            <div className="settings-desc" style={{ marginBottom: 6 }}>{config.description}</div>
            {!config.optional && (
              <div className="form-group" style={{ marginBottom: 0, position: 'relative' }}>
                <Input
                  id={`api-key-${config.name}`}
                  type={showKeys[config.name] ? 'text' : 'password'}
                  placeholder={providerHasKey(config.name) ? '•••••••••••••••• (saved — enter new to replace)' : config.placeholder}
                  value={apiKeys[config.name] || ''}
                  onChange={(e) => setApiKeys((prev) => ({ ...prev, [config.name]: e.target.value }))}
                  disabled={savingProvider === config.name}
                  style={{ paddingRight: 40 }}
                />
                <button
                  type="button"
                  onClick={() => toggleShowKey(config.name)}
                  style={{
                    position: 'absolute',
                    right: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--tx3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 4,
                  }}
                  aria-label={showKeys[config.name] ? 'Hide API key' : 'Show API key'}
                >
                  {showKeys[config.name] ? <TbEyeOff size={18} /> : <TbEye size={18} />}
                </button>
              </div>
            )}
            <div className={`key-status ${providerHasKey(config.name) || config.optional ? '' : 'missing'}`}>
              {config.optional
                ? 'Always available for development'
                : providerHasKey(config.name)
                  ? 'API key configured'
                  : 'No API key saved'}
            </div>
            <div className="btn-row" style={{ marginTop: 8 }}>
              {!config.optional && (
                <Button
                  variant="primary"
                  disabled={savingProvider === config.name}
                  onClick={() => handleSaveProvider(config)}
                >
                  {savingProvider === config.name ? 'Saving...' : 'Save key'}
                </Button>
              )}
              <Button
                variant={defaultProvider === config.name ? 'primary' : 'outline'}
                disabled={savingProvider === config.name}
                onClick={() => handleSetDefault(config.name)}
              >
                {defaultProvider === config.name && <TbCheck style={{ marginRight: 4 }} />}
                {defaultProvider === config.name ? 'Default' : 'Set as default'}
              </Button>
            </div>
          </div>
        ))}

        {saveMessage && (
          <div className={`notice ${saveMessage.toLowerCase().includes('fail') || saveMessage.includes('Enter') ? 'err' : ''}`} style={{ marginTop: 12 }}>
            {saveMessage}
          </div>
        )}
      </div>

      <div className="divider" />

      {/* ─── Generation Model Settings ─────────────────────────────── */}
      <div className="sec" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <TbBrandGoogle size={16} /> Generation Model Settings
      </div>
      <div className="card">
        <p style={{ fontSize: 12, color: 'var(--tx3)', marginBottom: 16 }}>
          Choose which Gemini models to use for image generation and video creation.
          These models will be used whenever you trigger generation from the workflow.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          {/* Image Model */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx2)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <TbBrandGoogle size={14} /> Image Generation Model
            </label>
            <select
              id="gemini-image-model-select"
              value={geminiImageModel}
              onChange={(e) => setGeminiImageModel(e.target.value)}
              style={{
                background: 'var(--bg2)', border: '1px solid var(--bd)',
                borderRadius: 6, padding: '8px 12px', fontSize: 12,
                color: 'var(--tx)', outline: 'none', cursor: 'pointer',
              }}
            >
              {GEMINI_IMAGE_MODELS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <div style={{ fontSize: 10, color: 'var(--tx4)', fontFamily: 'monospace', marginBottom: 4 }}>{geminiImageModel}</div>
            {(() => {
              const selectedModel = GEMINI_IMAGE_MODELS.find(m => m.value === geminiImageModel);
              if (selectedModel?.description) {
                return (
                  <div style={{
                    fontSize: 11,
                    color: 'var(--tx3)',
                    lineHeight: '1.4',
                    background: 'rgba(255, 255, 255, 0.03)',
                    padding: '8px 12px',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    marginTop: 4
                  }}>
                    {selectedModel.description}
                  </div>
                );
              }
              return null;
            })()}
          </div>

          {/* Video Model */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx2)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <TbVideo size={14} /> Video Generation Model
            </label>
            <select
              id="gemini-video-model-select"
              value={geminiVideoModel}
              onChange={(e) => setGeminiVideoModel(e.target.value)}
              style={{
                background: 'var(--bg2)', border: '1px solid var(--bd)',
                borderRadius: 6, padding: '8px 12px', fontSize: 12,
                color: 'var(--tx)', outline: 'none', cursor: 'pointer',
              }}
            >
              {GEMINI_VIDEO_MODELS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <div style={{ fontSize: 10, color: 'var(--tx4)', fontFamily: 'monospace' }}>{geminiVideoModel}</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button variant="primary" onClick={handleSaveModels} disabled={savingModels}>
            {savingModels ? 'Saving...' : 'Save Model Preferences'}
          </Button>
          {modelSaveMessage && (
            <span style={{
              fontSize: 12,
              color: modelSaveMessage.includes('success') ? 'var(--suc)' : 'var(--err)',
            }}>
              {modelSaveMessage}
            </span>
          )}
        </div>
      </div>

      <div className="divider" />
      <Button variant="danger-outline" onClick={onSignOut}>
        <TbLogout style={{ marginRight: 4 }} /> Sign out
      </Button>
    </div>
  );
};
