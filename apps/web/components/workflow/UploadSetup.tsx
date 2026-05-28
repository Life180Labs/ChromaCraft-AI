'use client';

import React, { useState } from 'react';
import { 
  TbUpload, TbChevronRight, TbChevronLeft, TbCheck, TbX, 
  TbCar, TbBike, TbShirt, TbDots, TbDeviceLaptop, TbShoppingBag,
  TbSettings, TbPalette, TbBook, TbCopy, TbArrowRight, TbCloud, TbLink, TbRefresh
} from 'react-icons/tb';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

type UploadSetupProps = {
  uploadFile: File | null;
  onFileChange: (f: File | null) => void;
  uploadError: string;
  loading: boolean;
  onSubmit: (e: React.FormEvent) => void;

  industry: string;
  onIndustryChange: (v: string) => void;
  modelName: string;
  onModelNameChange: (v: string) => void;
  filenamePrefix: string;
  onFilenamePrefixChange: (v: string) => void;

  targetAudience: string;
  onTargetAudienceChange: (v: string) => void;
  targetMarket: string;
  onTargetMarketChange: (v: string) => void;
  targetPurpose: string;
  onTargetPurposeChange: (v: string) => void;

  gridCols: number;
  onGridColsChange: (v: number) => void;
  gridRows: number;
  onGridRowsChange: (v: number) => void;

  lifestyleEnabled: boolean;
  onLifestyleChange: (v: boolean) => void;
  videoEnabled: boolean;
  onVideoChange: (v: boolean) => void;
  spinEnabled: boolean;
  onSpinChange: (v: boolean) => void;
  cropsEnabled: boolean;
  onCropsChange: (v: boolean) => void;

  customColors: string[];
  onCustomColorsChange: (colors: string[]) => void;

  promptText: string;
  onPromptChange: (v: string) => void;

  selectedProviderId: number | null;
  onSelectProvider: (id: number | null) => void;
  providers: Array<{ id: number; name: string; default: boolean }>;
};

const STEP_NAMES = ['Domain', 'Targeting', 'Outputs', 'Prompt', 'Confirmation'];

const INDUSTRIES = [
  { id: 'Automotive', name: 'Automotive', icon: TbCar, desc: 'Cars, SUVs, Commercial vehicles' },
  { id: '2-Wheeler', name: '2-Wheeler', icon: TbBike, desc: 'Bikes, Scooters, E-mopeds' },
  { id: 'Apparel', name: 'Apparel / Fashion', icon: TbShirt, desc: 'Clothes, Dresses, Outerwear' },
  { id: 'Footwear', name: 'Footwear', icon: TbDots, desc: 'Sneakers, Formal shoes, Athletic' },
  { id: 'Electronics', name: 'Electronics', icon: TbDeviceLaptop, desc: 'Laptops, Phones, Smarthome' },
  { id: 'Furniture', name: 'Furniture', icon: TbShoppingBag, desc: 'Tables, Chairs, Sofas, Decor' }
];

const TARGET_WHO = ['General consumers', 'Young urban', 'B2B/Dealers', 'Luxury segment', 'Value seekers', 'Families'];
const TARGET_MARKETS = ['India', 'MENA', 'North America', 'Southeast Asia', 'Europe', 'Global'];
const TARGET_PURPOSES = ['Product catalog', 'Social media', 'Dealer portals', 'Print catalog', 'Hero banners', 'Paid advertising'];

const PROMPT_TEMPLATES: Record<string, string> = {
  'Standard Catalog v2.3': 'Generate a photorealistic [MODEL] in [COLOR] paint.\nAudience: [AUDIENCE] · [MARKET] market.\nUse: [PURPOSE].\nView: front-right three-quarter. Drive: LHD.\nPlate: white, blank. Background: pure white. No overlap.',
  'Dynamic Action Banner v1.0': 'Dynamic dramatic action shot of [MODEL] in [COLOR] paint drifting on wet asphalt.\nAudience: [AUDIENCE] · [MARKET] market.\nUse: [PURPOSE].\nCinematic lighting, high speed motion blur.',
  'Minimalist Studio Spotlight v1.4': 'Minimalist studio product shot of [MODEL] in [COLOR] paint.\nAudience: [AUDIENCE] · [MARKET] market.\nUse: [PURPOSE].\nSoft moody spot lighting, clean concrete background.'
};

const COLOR_HEX: Record<string, string> = {
  'White': '#ffffff', 'Black': '#111111', 'Blue': '#2563eb', 'Red': '#dc2626',
  'Green': '#16a34a', 'Brown': '#78350f', 'Silver': '#9ca3af', 'Yellow': '#facc15',
  'Cream': '#fef3c7', 'Pink': '#db2777', 'Dark Blue': '#1e3a8a', 'Orange': '#ea580c'
};

const UC1_STANDARD_COLORS = [
  'Pristine White',
  'Oberon Black',
  'Electric Blue',
  'Empress Red',
];

export const UploadSetup: React.FC<UploadSetupProps> = ({
  uploadFile, onFileChange, uploadError, loading, onSubmit,
  industry, onIndustryChange, modelName, onModelNameChange,
  filenamePrefix, onFilenamePrefixChange,
  targetAudience, onTargetAudienceChange,
  targetMarket, onTargetMarketChange,
  targetPurpose, onTargetPurposeChange,
  gridCols, onGridColsChange,
  gridRows, onGridRowsChange,
  lifestyleEnabled, onLifestyleChange,
  videoEnabled, onVideoChange,
  spinEnabled, onSpinChange,
  cropsEnabled, onCropsChange,
  customColors, onCustomColorsChange,
  promptText, onPromptChange,
  selectedProviderId, onSelectProvider,
  providers
}) => {
  const [activeStep, setActiveStep] = useState(0);

  // Modals state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [showPromptLibrary, setShowPromptLibrary] = useState(false);

  // Upload modal active tab
  const [uploadTab, setUploadTab] = useState<'device' | 'url' | 'cloud'>('device');
  const [urlInput, setUrlInput] = useState('');
  const [mockUploadMsg, setMockUploadMsg] = useState('');

  // Prompt editor state
  const [editorText, setEditorText] = useState(promptText);
  const [appliedGuides, setAppliedGuides] = useState<string[]>([]);

  // Prompt library selected template
  const [selectedLibTemplate, setSelectedLibTemplate] = useState('Standard Catalog v2.3');

  // Math helper
  const totalVariants = gridCols * gridRows;
  
  // Cost calculations
  const baseCost = 12.0;
  const lifestyleCost = lifestyleEnabled ? 15.0 : 0.0;
  const videoCost = videoEnabled ? 30.0 : 0.0;
  const spinCost = spinEnabled ? 45.0 : 0.0;
  const cropsCost = cropsEnabled ? 5.0 : 0.0;
  const totalCost = baseCost + lifestyleCost + videoCost + spinCost + cropsCost;

  // Actions
  const handleNext = () => {
    if (activeStep < STEP_NAMES.length - 1) {
      setActiveStep(activeStep + 1);
    }
  };

  const handleBack = () => {
    if (activeStep > 0) {
      setActiveStep(activeStep - 1);
    }
  };

  const handleGridAdjust = (dim: 'cols' | 'rows', amount: number) => {
    if (dim === 'cols') {
      onGridColsChange(Math.max(1, Math.min(6, gridCols + amount)));
    } else {
      onGridRowsChange(Math.max(1, Math.min(6, gridRows + amount)));
    }
  };

  const handleUploadConfirm = (name: string) => {
    setMockUploadMsg(name);
    setShowUploadModal(false);
  };

  const handleSavePrompt = () => {
    onPromptChange(editorText);
    setShowPromptEditor(false);
  };

  const handleResetPrompt = () => {
    const defaultPrompt = `Generate a photorealistic [${modelName || 'Mitsubishi ASX'}] in [COLOR] paint.\nAudience: ${targetAudience.toLowerCase()} · ${targetMarket.toLowerCase()} market.\nUse: ${targetPurpose.toLowerCase()}.\nView: front-right three-quarter. Drive: LHD.\nPlate: white, blank. Background: pure white. No overlap.`;
    setEditorText(defaultPrompt);
    setAppliedGuides([]);
  };

  const handleLoadLibPrompt = () => {
    const rawTemplate = PROMPT_TEMPLATES[selectedLibTemplate] || '';
    const populated = rawTemplate
      .replace('[MODEL]', modelName || 'Mitsubishi ASX')
      .replace('[AUDIENCE]', targetAudience.toLowerCase())
      .replace('[MARKET]', targetMarket.toLowerCase())
      .replace('[PURPOSE]', targetPurpose.toLowerCase());
    onPromptChange(populated);
    setShowPromptLibrary(false);
  };

  const addGuide = (guide: string) => {
    if (!appliedGuides.includes(guide)) {
      setAppliedGuides([...appliedGuides, guide]);
      setEditorText(prev => `${prev}\n// ${guide}`);
    }
  };

  const removeGuide = (guide: string) => {
    setAppliedGuides(appliedGuides.filter(g => g !== guide));
    setEditorText(prev => prev.replace(`\n// ${guide}`, ''));
  };

  return (
    <div className="screen active" style={{ maxWidth: '800px', margin: '0 auto' }}>
      {/* High-level Stepper */}
      <div className="stepper-wrap" style={{ marginBottom: '24px' }}>
        <div className="stepper" style={{ display: 'flex', justifyContent: 'space-between', position: 'relative', maxWidth: '500px', margin: '0 auto' }}>
          {/* Step 1: Configure */}
          <div className="step-item active" style={{ flex: 1, textAlign: 'center' }}>
            <div className="step-circle" style={{
              width: '28px', height: '28px', borderRadius: '50%',
              margin: '0 auto 6px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--acc)', color: '#fff', fontWeight: 600, fontSize: '12px', border: '1px solid var(--bd)'
            }}>1</div>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--tx)' }}>Configure</span>
          </div>
          {/* Line */}
          <div style={{ flex: 1, height: '2px', background: 'var(--bd)', alignSelf: 'center', margin: '0 -20px 14px' }}></div>
          {/* Step 2: Prompt */}
          <div className="step-item" style={{ flex: 1, textAlign: 'center' }}>
            <div className="step-circle" style={{
              width: '28px', height: '28px', borderRadius: '50%',
              margin: '0 auto 6px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--bg3)', color: 'var(--tx3)', fontWeight: 600, fontSize: '12px', border: '1px solid var(--bd)'
            }}>2</div>
            <span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--tx3)' }}>Prompt</span>
          </div>
          {/* Line */}
          <div style={{ flex: 1, height: '2px', background: 'var(--bd)', alignSelf: 'center', margin: '0 -20px 14px' }}></div>
          {/* Step 3: Generate */}
          <div className="step-item" style={{ flex: 1, textAlign: 'center' }}>
            <div className="step-circle" style={{
              width: '28px', height: '28px', borderRadius: '50%',
              margin: '0 auto 6px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--bg3)', color: 'var(--tx3)', fontWeight: 600, fontSize: '12px', border: '1px solid var(--bd)'
            }}>3</div>
            <span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--tx3)' }}>Generate</span>
          </div>
        </div>
      </div>

      {/* STEP 1: INDUSTRY */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ textTransform: 'uppercase', fontSize: '11px', fontWeight: 600, color: 'var(--tx3)', letterSpacing: '0.05em', marginBottom: '10px' }}>
          STEP 1 – INDUSTRY
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px' }}>
          {INDUSTRIES.map(ind => {
            const Icon = ind.icon;
            const isSel = industry === ind.id;
            return (
              <button
                key={ind.id}
                type="button"
                className={`cloud-opt ${isSel ? 'sel' : ''}`}
                style={{
                  border: isSel ? '2px solid var(--acc)' : '1px solid var(--bd)',
                  background: isSel ? 'var(--acc-bg)' : 'var(--bg2)',
                  padding: '16px 8px',
                  borderRadius: 'var(--r-lg)',
                  textAlign: 'center',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  transition: 'all 0.2s ease'
                }}
                onClick={() => onIndustryChange(ind.id)}
              >
                <Icon size={22} style={{ color: isSel ? 'var(--acc)' : 'var(--tx3)' }} />
                <span style={{ fontWeight: 600, fontSize: '12px', color: 'var(--tx)' }}>{ind.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* STEP 2: PRODUCT IMAGE */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ textTransform: 'uppercase', fontSize: '11px', fontWeight: 600, color: 'var(--tx3)', letterSpacing: '0.05em', marginBottom: '10px' }}>
          STEP 2 – PRODUCT IMAGE
        </div>
        <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div 
            className={`drop-zone ${uploadFile || mockUploadMsg ? 'done' : ''}`}
            onClick={() => setShowUploadModal(true)}
            style={{ padding: '30px 20px', border: '2px dashed var(--bd)', borderRadius: 'var(--r-lg)', textAlign: 'center', cursor: 'pointer', background: 'var(--bg)' }}
          >
            <TbUpload size={32} style={{ margin: '0 auto 8px', color: 'var(--tx3)' }} />
            <p style={{ fontSize: '13px', fontWeight: 500, color: 'var(--tx)' }}>
              {uploadFile ? uploadFile.name : mockUploadMsg ? mockUploadMsg : 'Click to upload – device, URL, or cloud'}
            </p>
            <small style={{ fontSize: '11px', color: 'var(--tx3)' }}>PNG - JPG - min 800x600 - or product page URL</small>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div className="field">
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--tx)', marginBottom: '6px', display: 'block' }}>Product / model name</label>
              <Input 
                placeholder="Mitsubishi ASX" 
                value={modelName} 
                onChange={(e) => {
                  onModelNameChange(e.target.value);
                  onFilenamePrefixChange(e.target.value.replace(/\s+/g, '_'));
                }} 
                required 
              />
            </div>
            <div className="field">
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--tx)', marginBottom: '6px', display: 'block' }}>Original filename prefix</label>
              <Input 
                placeholder="Mitsubishi_ASX" 
                value={filenamePrefix} 
                onChange={(e) => onFilenamePrefixChange(e.target.value.replace(/\s+/g, '_'))} 
              />
            </div>
          </div>
        </div>
      </div>

      {/* STEP 3: TARGETING */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ textTransform: 'uppercase', fontSize: '11px', fontWeight: 600, color: 'var(--tx3)', letterSpacing: '0.05em', marginBottom: '10px' }}>
          STEP 3 – TARGETING
        </div>
        <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Who is this for? */}
          <div className="sq" style={{ margin: 0 }}>
            <div className="sq-label" style={{ fontSize: '11px', fontWeight: 600, color: 'var(--tx)', marginBottom: '8px' }}>Who is this for?</div>
            <div className="sq-opts" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {TARGET_WHO.map(opt => (
                <button 
                  type="button"
                  key={opt} 
                  className={`sq-opt ${targetAudience === opt ? 'sel' : ''}`}
                  style={{
                    padding: '6px 14px', borderRadius: '20px', fontSize: '11px', fontWeight: 500,
                    border: '1px solid var(--bd)', background: targetAudience === opt ? 'var(--acc)' : 'var(--bg2)',
                    color: targetAudience === opt ? '#fff' : 'var(--tx2)', cursor: 'pointer', transition: 'all 0.2s'
                  }}
                  onClick={() => onTargetAudienceChange(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          {/* Target market */}
          <div className="sq" style={{ margin: 0 }}>
            <div className="sq-label" style={{ fontSize: '11px', fontWeight: 600, color: 'var(--tx)', marginBottom: '8px' }}>Target market</div>
            <div className="sq-opts" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {TARGET_MARKETS.map(opt => (
                <button 
                  type="button"
                  key={opt} 
                  className={`sq-opt ${targetMarket === opt ? 'sel' : ''}`}
                  style={{
                    padding: '6px 14px', borderRadius: '20px', fontSize: '11px', fontWeight: 500,
                    border: '1px solid var(--bd)', background: targetMarket === opt ? 'var(--acc)' : 'var(--bg2)',
                    color: targetMarket === opt ? '#fff' : 'var(--tx2)', cursor: 'pointer', transition: 'all 0.2s'
                  }}
                  onClick={() => onTargetMarketChange(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          {/* Purpose / Use */}
          <div className="sq" style={{ margin: 0 }}>
            <div className="sq-label" style={{ fontSize: '11px', fontWeight: 600, color: 'var(--tx)', marginBottom: '8px' }}>Purpose</div>
            <div className="sq-opts" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {TARGET_PURPOSES.map(opt => (
                <button 
                  type="button"
                  key={opt} 
                  className={`sq-opt ${targetPurpose === opt ? 'sel' : ''}`}
                  style={{
                    padding: '6px 14px', borderRadius: '20px', fontSize: '11px', fontWeight: 500,
                    border: '1px solid var(--bd)', background: targetPurpose === opt ? 'var(--acc)' : 'var(--bg2)',
                    color: targetPurpose === opt ? '#fff' : 'var(--tx2)', cursor: 'pointer', transition: 'all 0.2s'
                  }}
                  onClick={() => onTargetPurposeChange(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* STEP 4: OUTPUT STEPS */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <div style={{ textTransform: 'uppercase', fontSize: '11px', fontWeight: 600, color: 'var(--tx3)', letterSpacing: '0.05em' }}>
            STEP 4 – OUTPUT STEPS
          </div>
          <button type="button" style={{ fontSize: '9px', fontWeight: 600, color: 'var(--tx3)', border: '1px solid var(--bd)', borderRadius: '4px', padding: '2px 6px', background: 'var(--bg2)', cursor: 'pointer' }}>
            TOGGLE TO CONTROL COST
          </button>
        </div>
        <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          
          {/* Color variant grid */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: 'var(--bg2)', borderRadius: 'var(--r-md)', border: '1px solid var(--bd)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
              <input type="checkbox" checked readOnly style={{ accentColor: 'var(--acc)' }} />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontWeight: 600, fontSize: '12px', color: 'var(--tx)' }}>Color variant grid</span>
                  <span style={{ fontSize: '9px', fontWeight: 600, background: 'var(--suc-bg)', color: 'var(--suc)', padding: '1px 4px', borderRadius: '3px' }}>Always on</span>
                </div>
                <small style={{ fontSize: '11px', color: 'var(--tx3)' }}>{gridCols} cols × {gridRows} rows = {totalVariants} variants</small>
                
                {/* Row/Col editor controls */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
                    <span>Cols</span>
                    <button type="button" onClick={() => handleGridAdjust('cols', -1)} style={{ width: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--bd)', borderRadius: '3px', background: 'var(--bg)' }}>-</button>
                    <span style={{ fontWeight: 600 }}>{gridCols}</span>
                    <button type="button" onClick={() => handleGridAdjust('cols', 1)} style={{ width: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--bd)', borderRadius: '3px', background: 'var(--bg)' }}>+</button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
                    <span>Rows</span>
                    <button type="button" onClick={() => handleGridAdjust('rows', -1)} style={{ width: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--bd)', borderRadius: '3px', background: 'var(--bg)' }}>-</button>
                    <span style={{ fontWeight: 600 }}>{gridRows}</span>
                    <button type="button" onClick={() => handleGridAdjust('rows', 1)} style={{ width: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--bd)', borderRadius: '3px', background: 'var(--bg)' }}>+</button>
                  </div>

                  <div style={{ display: 'flex', gap: '2px', marginLeft: '6px' }}>
                    {Array.from({ length: totalVariants }).map((_, idx) => {
                      const curColor = customColors[idx] || UC1_STANDARD_COLORS[idx % UC1_STANDARD_COLORS.length];
                      const bgStyle = COLOR_HEX[curColor] || curColor;
                      return (
                        <div key={idx} style={{ width: '8px', height: '8px', borderRadius: '1px', background: bgStyle }} />
                      );
                    })}
                  </div>
                </div>

                {/* Color selectors list */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>
                  {Array.from({ length: totalVariants }).map((_, idx) => {
                    const currentColor = customColors[idx] || UC1_STANDARD_COLORS[idx % UC1_STANDARD_COLORS.length];
                    return (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--bg)', border: '1px solid var(--bd)', padding: '2px 4px', borderRadius: '4px' }}>
                        <span style={{ fontSize: '9px', color: 'var(--tx3)' }}>V{idx+1}:</span>
                        <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: COLOR_HEX[currentColor] || currentColor }} />
                        <select
                          value={currentColor}
                          onChange={(e) => {
                            const val = e.target.value;
                            const updated = [...customColors];
                            updated[idx] = val;
                            onCustomColorsChange(updated);
                          }}
                          style={{ background: 'transparent', border: 'none', fontSize: '9px', color: 'var(--tx)', padding: 0 }}
                        >
                          {UC1_STANDARD_COLORS.map(c => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>

              </div>
            </div>
            <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
              <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>-${baseCost.toFixed(2)}</span>
              <button type="button" className="toggle on" disabled />
            </div>
          </div>

          {/* Background removal */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: 'var(--bg2)', borderRadius: 'var(--r-md)', border: '1px solid var(--bd)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input type="checkbox" checked readOnly style={{ accentColor: 'var(--acc)' }} />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontWeight: 600, fontSize: '12px', color: 'var(--tx)' }}>Background removal + PNG export</span>
                  <span style={{ fontSize: '9px', fontWeight: 600, background: 'var(--suc-bg)', color: 'var(--suc)', padding: '1px 4px', borderRadius: '3px' }}>Always on</span>
                </div>
                <small style={{ fontSize: '11px', color: 'var(--tx3)' }}>matting → spill → uniform sizing → auto-naming</small>
              </div>
            </div>
            <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
              <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>-$0.08</span>
              <button type="button" className="toggle on" disabled />
            </div>
          </div>

          {/* Lifestyle Placement */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: 'var(--bg2)', borderRadius: 'var(--r-md)', border: '1px solid var(--bd)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input type="checkbox" checked={lifestyleEnabled} onChange={(e) => onLifestyleChange(e.target.checked)} style={{ accentColor: 'var(--acc)' }} />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontWeight: 600, fontSize: '12px', color: 'var(--tx)' }}>Lifestyle / scene imagery</span>
                  <span style={{ fontSize: '9px', fontWeight: 600, background: 'var(--bg3)', color: 'var(--tx3)', padding: '1px 4px', borderRadius: '3px' }}>Optional</span>
                </div>
                <small style={{ fontSize: '11px', color: 'var(--tx3)' }}>People in context - Controlled placement, proportions</small>
              </div>
            </div>
            <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
              <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>-${lifestyleCost.toFixed(2)}</span>
              <button 
                type="button" 
                className={`toggle ${lifestyleEnabled ? 'on' : 'off'}`} 
                onClick={() => onLifestyleChange(!lifestyleEnabled)} 
              />
            </div>
          </div>

          {/* Promo video clip */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: 'var(--bg2)', borderRadius: 'var(--r-md)', border: '1px solid var(--bd)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input type="checkbox" checked={videoEnabled} onChange={(e) => onVideoChange(e.target.checked)} style={{ accentColor: 'var(--acc)' }} />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontWeight: 600, fontSize: '12px', color: 'var(--tx)' }}>Promo video clip</span>
                  <span style={{ fontSize: '9px', fontWeight: 600, background: 'var(--bg3)', color: 'var(--tx3)', padding: '1px 4px', borderRadius: '3px' }}>Optional</span>
                </div>
                <small style={{ fontSize: '11px', color: 'var(--tx3)' }}>8-15 sec AI clip via Runway / Kling</small>
              </div>
            </div>
            <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
              <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>-${videoCost.toFixed(2)}</span>
              <button 
                type="button" 
                className={`toggle ${videoEnabled ? 'on' : 'off'}`} 
                onClick={() => onVideoChange(!videoEnabled)} 
              />
            </div>
          </div>

          {/* 360 spin set */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: 'var(--bg2)', borderRadius: 'var(--r-md)', border: '1px solid var(--bd)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input type="checkbox" checked={spinEnabled} onChange={(e) => onSpinChange(e.target.checked)} style={{ accentColor: 'var(--acc)' }} />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontWeight: 600, fontSize: '12px', color: 'var(--tx)' }}>360° spin set</span>
                  <span style={{ fontSize: '9px', fontWeight: 600, background: 'var(--bg3)', color: 'var(--tx3)', padding: '1px 4px', borderRadius: '3px' }}>Optional</span>
                </div>
                <small style={{ fontSize: '11px', color: 'var(--tx3)' }}>8-12 angle views for e-commerce</small>
              </div>
            </div>
            <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
              <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>-${spinCost.toFixed(2)}</span>
              <button 
                type="button" 
                className={`toggle ${spinEnabled ? 'on' : 'off'}`} 
                onClick={() => onSpinChange(!spinEnabled)} 
              />
            </div>
          </div>

          {/* Social media crops */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: 'var(--bg2)', borderRadius: 'var(--r-md)', border: '1px solid var(--bd)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input type="checkbox" checked={cropsEnabled} onChange={(e) => onCropsChange(e.target.checked)} style={{ accentColor: 'var(--acc)' }} />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontWeight: 600, fontSize: '12px', color: 'var(--tx)' }}>Social media crops</span>
                  <span style={{ fontSize: '9px', fontWeight: 600, background: 'var(--bg3)', color: 'var(--tx3)', padding: '1px 4px', borderRadius: '3px' }}>Optional</span>
                </div>
                <small style={{ fontSize: '11px', color: 'var(--tx3)' }}>Instagram, X/blog, LinkedIn banner - auto-sized</small>
              </div>
            </div>
            <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
              <span style={{ fontSize: '11px', color: 'var(--suc)' }}>Free</span>
              <button 
                type="button" 
                className={`toggle ${cropsEnabled ? 'on' : 'off'}`} 
                onClick={() => onCropsChange(!cropsEnabled)} 
              />
            </div>
          </div>

          {/* Summary footer */}
          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--bd)', paddingTop: '10px', fontSize: '11px', color: 'var(--tx3)' }}>
            <span>Steps set: <strong>{3 + (lifestyleEnabled?1:0) + (videoEnabled?1:0) + (spinEnabled?1:0) + (cropsEnabled?1:0)}</strong></span>
            <span>Images: <strong>{totalVariants}</strong></span>
            <span>Est. cost: <strong style={{ color: 'var(--acc2)' }}>${totalCost.toFixed(2)}</strong></span>
          </div>

        </div>
      </div>

      {/* STEP 5: REVIEW PROMPT */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ textTransform: 'uppercase', fontSize: '11px', fontWeight: 600, color: 'var(--tx3)', letterSpacing: '0.05em', marginBottom: '10px' }}>
          STEP 5 – REVIEW PROMPT
        </div>
        <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="checkbox" checked readOnly style={{ accentColor: 'var(--acc)' }} />
              <span style={{ fontWeight: 600, fontSize: '12px', color: 'var(--tx)' }}>Auto-generated system prompt</span>
            </div>
            <span style={{ fontSize: '9px', fontWeight: 600, border: '1px solid var(--bd)', borderRadius: '4px', padding: '2px 6px', background: 'var(--bg2)', color: 'var(--tx3)' }}>
              v2.3 - {industry} - {targetMarket}
            </span>
          </div>

          {/* Blue Callout Call */}
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 'var(--r)', padding: '10px', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
            <div style={{ color: '#2563eb', fontSize: '14px', lineHeight: 1 }}>ℹ</div>
            <div style={{ fontSize: '11px', color: '#1e3a8a', lineHeight: 1.3 }}>
              Built from your answers in Steps 1-3. Edit only if needed, or load from your prompt library.
            </div>
          </div>

          {/* Prompt text area */}
          <div className="field" style={{ margin: 0 }}>
            <textarea 
              value={promptText} 
              onChange={(e) => onPromptChange(e.target.value)}
              style={{ 
                width: '100%', minHeight: '120px', fontFamily: 'monospace', 
                fontSize: '11px', padding: '12px', background: 'var(--bg2)', 
                border: '1px solid var(--bd)', borderRadius: 'var(--r)', color: 'var(--tx)', outline: 'none'
              }}
            />
          </div>

          {/* Preset Library Buttons */}
          <div style={{ display: 'flex', gap: '10px' }}>
            <button type="button" onClick={() => { setEditorText(promptText); setShowPromptEditor(true); }} style={{ flex: 1, padding: '8px', fontSize: '11px', fontWeight: 600, border: '1px solid var(--bd)', borderRadius: 'var(--r)', background: 'var(--bg)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
              <TbPalette size={13} style={{ marginRight: '4px' }} /> Edit / refine prompt
            </button>
            <button type="button" onClick={() => setShowPromptLibrary(true)} style={{ flex: 1, padding: '8px', fontSize: '11px', fontWeight: 600, border: '1px solid var(--bd)', borderRadius: 'var(--r)', background: 'var(--bg)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
              <TbBook size={13} style={{ marginRight: '4px' }} /> Load from library
            </button>
            <button type="button" onClick={() => alert('Prompt saved to library')} style={{ flex: 1, padding: '8px', fontSize: '11px', fontWeight: 600, border: '1px solid var(--bd)', borderRadius: 'var(--r)', background: 'var(--bg)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
              <TbCopy size={13} style={{ marginRight: '4px' }} /> Save to library
            </button>
          </div>

          {uploadError && <div className="notice err" style={{ marginTop: '10px' }}>{uploadError}</div>}
        </div>
      </div>

      {/* Action Buttons Row */}
      <div className="btn-row" style={{ display: 'flex', gap: '12px', marginTop: '24px', marginBottom: '24px' }}>
        <Button 
          type="button" 
          variant="primary" 
          onClick={onSubmit}
          disabled={loading || (!uploadFile && !mockUploadMsg)}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--acc)', borderColor: 'var(--acc)', color: '#fff', padding: '12px 24px', height: 'auto', fontSize: '13px', fontWeight: 600 }}
        >
          {loading ? 'Processing...' : 'Confirm & start generation'} <TbArrowRight size={16} />
        </Button>
        
        <Button 
          type="button" 
          variant="outline" 
          onClick={() => {
            alert('Draft saved successfully!');
          }}
          disabled={loading}
          style={{ padding: '12px 24px', height: 'auto', fontSize: '13px', fontWeight: 600 }}
        >
          Save draft
        </Button>
      </div>

      {/* Footer */}
      <div style={{ borderTop: '1px solid var(--bd)', paddingTop: '16px', marginTop: '32px', display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--tx3)' }}>
        <div>ChromaCraft AI - © 2026 Life180 Labs - All rights reserved.</div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <a href="#" style={{ color: 'var(--tx3)', textDecoration: 'none' }}>Privacy</a>
          <a href="#" style={{ color: 'var(--tx3)', textDecoration: 'none' }}>Terms</a>
          <a href="#" style={{ color: 'var(--tx3)', textDecoration: 'none' }}>Life180labs.com</a>
        </div>
      </div>

      {/* ── MODAL: UPLOAD SOURCE SELECTOR ── */}
      <div className={`overlay ${showUploadModal ? 'open' : ''}`}>
        <div className="modal" style={{ width: '520px' }}>
          <button className="modal-close" onClick={() => setShowUploadModal(false)}>
            <TbX size={18} />
          </button>
          <div className="modal-title">Select Reference Asset</div>
          <div className="modal-sub">Choose files from local storage, URL parser, or cloud.</div>

          {/* Upload tabs */}
          <div className="upload-tabs">
            <button className={`upload-tab-btn ${uploadTab === 'device' ? 'active' : ''}`} onClick={() => setUploadTab('device')}>
              Local Storage
            </button>
            <button className={`upload-tab-btn ${uploadTab === 'url' ? 'active' : ''}`} onClick={() => setUploadTab('url')}>
              URL Link
            </button>
            <button className={`upload-tab-btn ${uploadTab === 'cloud' ? 'active' : ''}`} onClick={() => setUploadTab('cloud')}>
              Cloud Provider
            </button>
          </div>

          {/* TAB 1: DEVICE */}
          {uploadTab === 'device' && (
            <div className="upload-panel active">
              <div 
                className="drop-zone"
                onClick={() => document.getElementById('file-picker-modal')?.click()}
              >
                <TbUpload size={32} style={{ margin: '0 auto 8px', color: 'var(--tx3)' }} />
                <p>Click to browse local files</p>
                <small>Supports PNG, JPG (min 800x600 px)</small>
              </div>
              <input 
                id="file-picker-modal"
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  if (file) {
                    onFileChange(file);
                    handleUploadConfirm(file.name);
                  }
                }}
              />
            </div>
          )}

          {/* TAB 2: URL */}
          {uploadTab === 'url' && (
            <div className="upload-panel active">
              <div className="url-row">
                <input 
                  type="text" 
                  placeholder="https://example.com/asset-image.jpg"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                />
                <Button 
                  onClick={() => {
                    if (!urlInput.trim()) return;
                    // Create mock File object for URL input
                    const mockFile = new File(['url-content'], 'url_asset.png', { type: 'image/png' });
                    onFileChange(mockFile);
                    handleUploadConfirm(`URL: ${urlInput.slice(0, 30)}...`);
                  }}
                >
                  Verify URL
                </Button>
              </div>
              <small style={{ display: 'block', marginTop: '6px', color: 'var(--tx3)' }}>
                Image must be publicly accessible and serve standard images.
              </small>
            </div>
          )}

          {/* TAB 3: CLOUD */}
          {uploadTab === 'cloud' && (
            <div className="upload-panel active">
              <div className="cloud-grid">
                {['Google Drive', 'Dropbox', 'AWS S3', 'Box'].map(provider => (
                  <div 
                    key={provider} 
                    className="cloud-opt"
                    onClick={() => {
                      // Create mock File object for Cloud input
                      const mockFile = new File(['cloud-content'], `${provider.toLowerCase().replace(' ', '_')}_asset.png`, { type: 'image/png' });
                      onFileChange(mockFile);
                      handleUploadConfirm(`Cloud: ${provider}`);
                    }}
                  >
                    <TbCloud size={24} />
                    <span>{provider}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── MODAL: CUSTOM PROMPT EDITOR ── */}
      <div className={`overlay ${showPromptEditor ? 'open' : ''}`}>
        <div className="modal prompt-modal">
          <button className="modal-close" onClick={() => setShowPromptEditor(false)}>
            <TbX size={18} />
          </button>
          <div className="modal-title">Customize Base Prompt System</div>
          <div className="modal-sub">Add targeting rules and modifiers directly to customize generation parameters.</div>

          {/* Suggestion Chips */}
          <div className="sq-label" style={{ marginBottom: '6px' }}>Guided Suggestion Modifiers</div>
          <div className="guided-chips">
            {['studio backdrop', 'volumetric light', 'ultra realistic 8k', 'smooth reflections', 'soft shadows', 'cyberpunk studio'].map(guide => {
              const isSel = appliedGuides.includes(guide);
              return (
                <button 
                  key={guide}
                  type="button"
                  className={`guided-chip ${isSel ? 'sel' : ''}`}
                  onClick={() => isSel ? removeGuide(guide) : addGuide(guide)}
                >
                  + {guide}
                </button>
              );
            })}
          </div>

          {/* Edit text area */}
          <div className="field">
            <textarea 
              value={editorText} 
              onChange={(e) => setEditorText(e.target.value)}
              style={{ 
                width: '100%', minHeight: '160px', fontFamily: 'monospace', 
                fontSize: '11px', padding: '12px', background: 'var(--bg2)', 
                border: '1px solid var(--bd)', borderRadius: 'var(--r)', color: 'var(--tx)', outline: 'none'
              }}
            />
          </div>

          {/* Action Row */}
          <div className="btn-row" style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px' }}>
            <Button variant="outline" onClick={handleResetPrompt}>
              Reset Defaults
            </Button>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button variant="outline" onClick={() => setShowPromptEditor(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleSavePrompt}>
                Apply & Save
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ── MODAL: PROMPT LIBRARY SELECTOR ── */}
      <div className={`overlay ${showPromptLibrary ? 'open' : ''}`}>
        <div className="modal" style={{ width: '480px' }}>
          <button className="modal-close" onClick={() => setShowPromptLibrary(false)}>
            <TbX size={18} />
          </button>
          <div className="modal-title">Prompt Template Library</div>
          <div className="modal-sub">Choose a verified pre-configured prompt layout to populate.</div>

          <div className="lib-select-list">
            {Object.keys(PROMPT_TEMPLATES).map(tmplName => {
              const isSel = selectedLibTemplate === tmplName;
              return (
                <div 
                  key={tmplName}
                  className={`lib-select-item ${isSel ? 'sel' : ''}`}
                  onClick={() => setSelectedLibTemplate(tmplName)}
                >
                  <div className="lib-item-name">{tmplName}</div>
                  <div className="lib-item-meta">v1.{tmplName.length % 9} · active</div>
                </div>
              );
            })}
          </div>

          <div className="btn-row" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
            <Button variant="outline" onClick={() => setShowPromptLibrary(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleLoadLibPrompt}>
              Load Template
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
