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
  'White',
  'Black',
  'Blue',
  'Red',
  'Green',
  'Brown',
  'Silver',
  'Yellow',
  'Cream',
  'Pink',
  'Dark Blue',
  'Orange',
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
    <div className="screen active">
      {/* Wizard Header Stepper */}
      <div className="stepper-wrap" style={{ marginBottom: '24px' }}>
        <div className="stepper" style={{ display: 'flex', justifyContent: 'space-between', position: 'relative' }}>
          {STEP_NAMES.map((name, idx) => (
            <div 
              key={name} 
              className={`step-item ${idx === activeStep ? 'active' : ''} ${idx < activeStep ? 'done' : ''}`}
              style={{ flex: 1, textAlign: 'center', cursor: idx < activeStep ? 'pointer' : 'default' }}
              onClick={() => idx < activeStep && setActiveStep(idx)}
            >
              <div 
                className="step-circle" 
                style={{ 
                  width: '28px', height: '28px', borderRadius: '50%', 
                  margin: '0 auto 6px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: idx === activeStep ? 'var(--acc)' : idx < activeStep ? 'var(--acc-bg)' : 'var(--bg3)',
                  color: idx === activeStep ? '#fff' : idx < activeStep ? 'var(--acc-tx)' : 'var(--tx3)',
                  fontWeight: 600, fontSize: '12px', border: '1px solid var(--bd)'
                }}
              >
                {idx < activeStep ? <TbCheck size={14} /> : idx + 1}
              </div>
              <span style={{ fontSize: '11px', fontWeight: idx === activeStep ? 600 : 400, color: idx === activeStep ? 'var(--tx)' : 'var(--tx3)' }}>
                {name}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Main Wizard Form container */}
      <div className="card" style={{ padding: '24px', minHeight: '360px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        
        {/* Step Content Wrapper */}
        <div style={{ flex: 1 }}>

          {/* STEP 1: DOMAIN FOCUS */}
          {activeStep === 0 && (
            <div>
              <h3 className="modal-title" style={{ fontSize: '18px', marginBottom: '8px' }}>Select Industry/Domain</h3>
              <p style={{ fontSize: '12px', color: 'var(--tx3)', marginBottom: '20px' }}>
                Tailor the underlying AI layout generation pipelines for domain-specific parameters.
              </p>
              <div className="cloud-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                {INDUSTRIES.map(ind => {
                  const Icon = ind.icon;
                  const isSel = industry === ind.id;
                  return (
                    <div 
                      key={ind.id} 
                      className={`cloud-opt ${isSel ? 'sel' : ''}`} 
                      style={{ 
                        border: isSel ? '2px solid var(--acc)' : '1px solid var(--bd)',
                        background: isSel ? 'var(--acc-bg)' : 'var(--bg2)',
                        padding: '16px', borderRadius: 'var(--r-lg)', textAlign: 'center', cursor: 'pointer'
                      }}
                      onClick={() => {
                        onIndustryChange(ind.id);
                        handleNext();
                      }}
                    >
                      <Icon size={28} style={{ color: isSel ? 'var(--acc)' : 'var(--tx3)', marginBottom: '8px' }} />
                      <span style={{ fontWeight: 500, fontSize: '13px', color: 'var(--tx)' }}>{ind.name}</span>
                      <small style={{ fontSize: '10px', color: 'var(--tx3)', marginTop: '4px', display: 'block', lineHeight: 1.3 }}>{ind.desc}</small>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 2: TARGETING CONTEXT */}
          {activeStep === 1 && (
            <div>
              <h3 className="modal-title" style={{ fontSize: '18px', marginBottom: '8px' }}>Targeting & Positioning</h3>
              <p style={{ fontSize: '12px', color: 'var(--tx3)', marginBottom: '16px' }}>
                Configure marketing context settings to refine catalog generation outputs.
              </p>

              {/* Who is this for? */}
              <div className="sq">
                <div className="sq-label">Who is this for? (Audience)</div>
                <div className="sq-opts">
                  {TARGET_WHO.map(opt => (
                    <div 
                      key={opt} 
                      className={`sq-opt ${targetAudience === opt ? 'sel' : ''}`}
                      onClick={() => onTargetAudienceChange(opt)}
                    >
                      {opt}
                    </div>
                  ))}
                </div>
              </div>

              {/* Target market */}
              <div className="sq">
                <div className="sq-label">Target Market (Geography)</div>
                <div className="sq-opts">
                  {TARGET_MARKETS.map(opt => (
                    <div 
                      key={opt} 
                      className={`sq-opt ${targetMarket === opt ? 'sel' : ''}`}
                      onClick={() => onTargetMarketChange(opt)}
                    >
                      {opt}
                    </div>
                  ))}
                </div>
              </div>

              {/* Purpose / Use */}
              <div className="sq">
                <div className="sq-label">Intent / Purpose</div>
                <div className="sq-opts">
                  {TARGET_PURPOSES.map(opt => (
                    <div 
                      key={opt} 
                      className={`sq-opt ${targetPurpose === opt ? 'sel' : ''}`}
                      onClick={() => onTargetPurposeChange(opt)}
                    >
                      {opt}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: OUTPUT SPECIFICATION */}
          {activeStep === 2 && (
            <div>
              <h3 className="modal-title" style={{ fontSize: '18px', marginBottom: '8px' }}>Output Specifications</h3>
              <p style={{ fontSize: '12px', color: 'var(--tx3)', marginBottom: '16px' }}>
                Specify variation grid dimensions and select premium post-processing pipelines.
              </p>

              <div className="g2" style={{ gap: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                {/* Column 1: Grid Dimensions */}
                <div className="sq" style={{ padding: '16px' }}>
                  <div className="sq-label" style={{ marginBottom: '12px' }}>Color Variant Grid Size</div>
                  <div className="grid-editor">
                    <div className="dim-ctrl">
                      <label>Cols</label>
                      <button className="dim-btn" onClick={() => handleGridAdjust('cols', -1)}>-</button>
                      <span className="dim-val">{gridCols}</span>
                      <button className="dim-btn" onClick={() => handleGridAdjust('cols', 1)}>+</button>
                    </div>
                    <div className="dim-ctrl">
                      <label>Rows</label>
                      <button className="dim-btn" onClick={() => handleGridAdjust('rows', -1)}>-</button>
                      <span className="dim-val">{gridRows}</span>
                      <button className="dim-btn" onClick={() => handleGridAdjust('rows', 1)}>+</button>
                    </div>
                  </div>

                  <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div 
                      id="grid-mini" 
                      className="grid-mini"
                      style={{ 
                        gridTemplateColumns: `repeat(${gridCols}, 11px)`, 
                        background: 'var(--bg)', border: '1px solid var(--bd)', padding: '6px', borderRadius: '4px' 
                      }}
                    >
                      {Array.from({ length: totalVariants }).map((_, idx) => {
                        const curColor = customColors[idx] || UC1_STANDARD_COLORS[idx % UC1_STANDARD_COLORS.length];
                        const bgStyle = COLOR_HEX[curColor] || curColor;
                        return (
                          <div key={idx} className="grid-mini-cell" style={{ background: bgStyle }} />
                        );
                      })}
                    </div>
                    <div>
                      <small id="grid-desc" style={{ display: 'block', fontSize: '11px', color: 'var(--tx2)', fontWeight: 500 }}>
                        {gridCols} cols × {gridRows} rows = {totalVariants} variants
                      </small>
                      <small style={{ fontSize: '10px', color: 'var(--tx3)' }}>
                        Creates {totalVariants} high-res catalog images
                      </small>
                    </div>
                  </div>

                  {/* Configure Individual Colors */}
                  <div style={{ marginTop: '16px', borderTop: '1px solid var(--bd)', paddingTop: '12px' }}>
                    <div className="sq-label" style={{ marginBottom: '8px', fontSize: '12px' }}>Configure Variant Colors</div>
                    <div style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', paddingRight: '4px' }}>
                      {Array.from({ length: totalVariants }).map((_, idx) => {
                        const currentColor = customColors[idx] || UC1_STANDARD_COLORS[idx % UC1_STANDARD_COLORS.length];
                        const isPreset = UC1_STANDARD_COLORS.includes(currentColor);
                        
                        return (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '11px', minWidth: '40px', color: 'var(--tx2)' }}>Var {idx + 1}:</span>
                            
                            {/* Color indicator */}
                            <div 
                              style={{ 
                                width: '16px', height: '16px', borderRadius: '3px', 
                                background: COLOR_HEX[currentColor] || currentColor, 
                                border: '1px solid var(--bd)' 
                              }} 
                            />
                            
                            {/* Preset color selector */}
                            <select
                              value={isPreset ? currentColor : 'custom'}
                              onChange={(e) => {
                                const val = e.target.value;
                                const updated = [...customColors];
                                if (val === 'custom') {
                                  updated[idx] = '#2563eb'; // Default to blue hex
                                } else {
                                  updated[idx] = val;
                                }
                                onCustomColorsChange(updated);
                              }}
                              style={{ 
                                background: 'var(--bg)', border: '1px solid var(--bd)', 
                                borderRadius: '4px', padding: '2px 4px', fontSize: '11px', color: 'var(--tx)',
                                flex: 1, height: '24px'
                              }}
                            >
                              {UC1_STANDARD_COLORS.map(c => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                              <option value="custom">Custom (Hex)...</option>
                            </select>

                            {/* Hex input if custom */}
                            {!isPreset && (
                              <input
                                type="text"
                                value={currentColor}
                                onChange={(e) => {
                                  const updated = [...customColors];
                                  updated[idx] = e.target.value;
                                  onCustomColorsChange(updated);
                                }}
                                placeholder="#ffffff"
                                style={{
                                  width: '70px',
                                  background: 'var(--bg)',
                                  border: '1px solid var(--bd)',
                                  borderRadius: '4px',
                                  padding: '2px 4px',
                                  fontSize: '11px',
                                  color: 'var(--tx)',
                                  height: '24px'
                                }}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Column 2: Pipelines */}
                <div className="sq" style={{ padding: '16px' }}>
                  <div className="sq-label" style={{ marginBottom: '12px' }}>Workflow Pipeline Steps</div>
                  
                  {/* Step Row: Color Variants */}
                  <div className="step-row">
                    <div className="step-ico on"><TbPalette size={16} /></div>
                    <div className="step-info">
                      <div className="step-name">Color Variants</div>
                      <div className="step-desc">Custom paint finishes mapping</div>
                    </div>
                    <span className="step-cost">Base</span>
                  </div>

                  {/* Step Row: Background Removal */}
                  <div className="step-row">
                    <div className="step-ico on"><TbSettings size={16} /></div>
                    <div className="step-info">
                      <div className="step-name">Background Removal</div>
                      <div className="step-desc">Output transparent alpha mask</div>
                    </div>
                    <span className="step-cost" style={{ color: 'var(--suc)' }}>Free</span>
                  </div>

                  {/* Step Row: Lifestyle Scenes */}
                  <div className="step-row">
                    <div className="step-ico on"><TbUpload size={16} /></div>
                    <div className="step-info">
                      <div className="step-name">Lifestyle Placement</div>
                      <div className="step-desc">AI dynamic scene integration</div>
                    </div>
                    <button 
                      type="button" 
                      className={`toggle ${lifestyleEnabled ? 'on' : 'off'}`} 
                      onClick={() => onLifestyleChange(!lifestyleEnabled)} 
                    />
                  </div>

                  {/* Step Row: Spin 360 */}
                  <div className="step-row">
                    <div className="step-ico on"><TbRefresh size={16} style={{ animation: spinEnabled ? 'spin 3s linear infinite' : 'none' }} /></div>
                    <div className="step-info">
                      <div className="step-name">Spin 360 Video</div>
                      <div className="step-desc">Generate 360° interactive preview</div>
                    </div>
                    <button 
                      type="button" 
                      className={`toggle ${spinEnabled ? 'on' : 'off'}`} 
                      onClick={() => onSpinChange(!spinEnabled)} 
                    />
                  </div>
                </div>
              </div>

              {/* Cost bar summary */}
              <div className="cost-bar" style={{ marginTop: '16px' }}>
                <div className="ci">Base specs: <strong>${baseCost.toFixed(2)}</strong></div>
                {(lifestyleEnabled || videoEnabled || spinEnabled || cropsEnabled) && (
                  <div className="ci">Add-ons: <strong>${(lifestyleCost + videoCost + spinCost + cropsCost).toFixed(2)}</strong></div>
                )}
                <div className="ci total">Est. Cost: <strong>${totalCost.toFixed(2)}</strong></div>
              </div>
            </div>
          )}

          {/* STEP 4: PROMPT & REFERENCE */}
          {activeStep === 3 && (
            <div>
              <h3 className="modal-title" style={{ fontSize: '18px', marginBottom: '8px' }}>Prompting & Reference</h3>
              <p style={{ fontSize: '12px', color: 'var(--tx3)', marginBottom: '16px' }}>
                Define product naming metadata, upload reference file, and customize target prompts.
              </p>

              <div className="g2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                {/* Reference upload & Names */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div className="field">
                    <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--tx)' }}>Product / Model Name</label>
                    <Input 
                      placeholder="e.g. Mitsubishi ASX" 
                      value={modelName} 
                      onChange={(e) => {
                        onModelNameChange(e.target.value);
                        onFilenamePrefixChange(e.target.value.replace(/\s+/g, '_'));
                      }} 
                      required 
                    />
                  </div>

                  <div className="field">
                    <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--tx)' }}>Output Filename Prefix</label>
                    <Input 
                      placeholder="e.g. Mitsubishi_ASX" 
                      value={filenamePrefix} 
                      onChange={(e) => onFilenamePrefixChange(e.target.value.replace(/\s+/g, '_'))} 
                    />
                  </div>

                  <div className="field">
                    <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--tx)' }}>Reference File Asset</label>
                    <div 
                      className={`drop-zone ${uploadFile || mockUploadMsg ? 'done' : ''}`}
                      onClick={() => setShowUploadModal(true)}
                      style={{ padding: '20px 12px' }}
                    >
                      <TbUpload size={22} style={{ margin: '0 auto 6px', color: 'var(--tx3)' }} />
                      <p style={{ fontSize: '11px', color: 'var(--tx2)' }}>
                        {uploadFile ? uploadFile.name : mockUploadMsg ? mockUploadMsg : 'Add reference image (Device/Cloud)'}
                      </p>
                      <small style={{ fontSize: '9px', color: 'var(--tx3)' }}>PNG, JPG up to 10MB</small>
                    </div>
                  </div>
                </div>

                {/* Prompt display */}
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div className="field" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--tx)' }}>Base Prompt Template</label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button type="button" className="info-btn" onClick={() => setShowPromptLibrary(true)} style={{ width: 'auto', height: 'auto', borderRadius: '4px', padding: '2px 6px', border: '1px solid var(--bd2)' }}>
                          <TbBook size={11} style={{ marginRight: '3px', verticalAlign: 'middle' }} /> Library
                        </button>
                        <button type="button" className="info-btn" onClick={() => { setEditorText(promptText); setShowPromptEditor(true); }} style={{ width: 'auto', height: 'auto', borderRadius: '4px', padding: '2px 6px', border: '1px solid var(--bd2)' }}>
                          <TbPalette size={11} style={{ marginRight: '3px', verticalAlign: 'middle' }} /> Custom
                        </button>
                      </div>
                    </div>

                    <div className="prompt-box" style={{ flex: 1, fontSize: '10px', whiteSpace: 'pre-wrap', maxHeight: '180px', overflowY: 'auto' }}>
                      {promptText}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 5: FINAL CONFIRMATION */}
          {activeStep === 4 && (
            <div>
              <h3 className="modal-title" style={{ fontSize: '18px', marginBottom: '8px' }}>Confirm Setup Specification</h3>
              <p style={{ fontSize: '12px', color: 'var(--tx3)', marginBottom: '16px' }}>
                Review all configuration metadata prior to starting generation.
              </p>

              <div className="sq" style={{ padding: '16px', background: 'var(--bg2)' }}>
                <table className="cost-tbl">
                  <tbody>
                    <tr>
                      <td style={{ fontWeight: 600, width: '150px' }}>Industry Domain</td>
                      <td>{industry}</td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 600 }}>Model / Name</td>
                      <td>{modelName || 'Mitsubishi ASX'}</td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 600 }}>Prefix</td>
                      <td>{filenamePrefix || (modelName ? modelName.replace(/\s+/g, '_') : 'unspecified')}</td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 600 }}>Target Market</td>
                      <td>{targetMarket}</td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 600 }}>Target Audience</td>
                      <td>{targetAudience}</td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 600 }}>Output Variations</td>
                      <td>{gridCols} columns × {gridRows} rows = {totalVariants} image finishes</td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 600 }}>Workflow Steps</td>
                      <td>
                        Variants (on) · Background Removal (on) 
                        {lifestyleEnabled ? ' · Lifestyle Integration (on)' : ''}
                        {spinEnabled ? ' · Interactive 360 Spin (on)' : ''}
                      </td>
                    </tr>
                    <tr className="us">
                      <td style={{ fontWeight: 600 }}>Estimated Costs</td>
                      <td style={{ color: 'var(--acc2)' }}>${totalCost.toFixed(2)} credits</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {uploadError && <div className="notice err" style={{ marginBottom: '10px' }}>{uploadError}</div>}
            </div>
          )}

        </div>

        {/* Wizard Footer Navigation */}
        <div className="btn-row" style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--bd)', paddingTop: '16px', marginTop: '16px' }}>
          <Button 
            type="button" 
            variant="outline" 
            onClick={handleBack} 
            disabled={activeStep === 0 || loading}
            style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <TbChevronLeft size={16} /> Back
          </Button>

          {activeStep < STEP_NAMES.length - 1 ? (
            <Button 
              type="button" 
              variant="primary" 
              onClick={handleNext}
              disabled={activeStep === 3 && !uploadFile && !mockUploadMsg}
              style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              Next <TbChevronRight size={16} />
            </Button>
          ) : (
            <Button 
              type="button" 
              variant="primary" 
              onClick={onSubmit}
              disabled={loading || (!uploadFile && !mockUploadMsg)}
              style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--suc)', borderColor: 'var(--suc)', color: '#fff' }}
            >
              {loading ? 'Processing...' : 'Confirm & Start Generation'} <TbArrowRight size={16} />
            </Button>
          )}
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
