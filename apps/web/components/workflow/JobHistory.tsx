'use client';

import React, { useState } from 'react';
import { TbHistory, TbRefresh, TbPackage, TbBook, TbPlus, TbTrash } from 'react-icons/tb';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import type { Job } from '../shared/types';

type JobHistoryProps = {
  jobs: Job[];
  onRefresh: () => void;
  onSelectJob: (job: Job) => void;
};

type SavedPrompt = {
  id: string;
  name: string;
  content: string;
  createdAt: string;
};

const DEFAULT_PROMPTS: SavedPrompt[] = [
  {
    id: 'sp-1',
    name: 'Standard Catalog v2.3',
    content: 'Generate a photorealistic [MODEL] in [COLOR] paint.\nAudience: [AUDIENCE] · [MARKET] market.\nUse: [PURPOSE].\nView: front-right three-quarter. Drive: LHD.\nPlate: white, blank. Background: pure white. No overlap.',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'sp-2',
    name: 'Dynamic Action Banner v1.0',
    content: 'Dynamic dramatic action shot of [MODEL] in [COLOR] paint drifting on wet asphalt.\nAudience: [AUDIENCE] · [MARKET] market.\nUse: [PURPOSE].\nCinematic lighting, high speed motion blur.',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'sp-3',
    name: 'Minimalist Studio Spotlight v1.4',
    content: 'Minimalist studio product shot of [MODEL] in [COLOR] paint.\nAudience: [AUDIENCE] · [MARKET] market.\nUse: [PURPOSE].\nSoft moody spot lighting, clean concrete background.',
    createdAt: new Date().toISOString(),
  },
];

export const JobHistory: React.FC<JobHistoryProps> = ({ jobs, onRefresh, onSelectJob }) => {
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>(DEFAULT_PROMPTS);
  const [showNewPrompt, setShowNewPrompt] = useState(false);
  const [newPromptName, setNewPromptName] = useState('');
  const [newPromptContent, setNewPromptContent] = useState('');

  const handleCreatePrompt = () => {
    if (!newPromptName.trim() || !newPromptContent.trim()) return;
    const newPrompt: SavedPrompt = {
      id: `sp-${Date.now()}`,
      name: newPromptName.trim(),
      content: newPromptContent.trim(),
      createdAt: new Date().toISOString(),
    };
    setSavedPrompts([newPrompt, ...savedPrompts]);
    setNewPromptName('');
    setNewPromptContent('');
    setShowNewPrompt(false);
  };

  const handleDeletePrompt = (id: string) => {
    setSavedPrompts(savedPrompts.filter(p => p.id !== id));
  };

  return (
    <div className="screen active">
      {/* Job History section (TC_JOBS_001, TC_JOBS_002) */}
      <div className="sec">Job History</div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <Button variant="ghost" onClick={onRefresh}><TbRefresh /> Refresh</Button>
        </div>
        {jobs.length === 0 ? (
          <p style={{ color: 'var(--tx3)', fontSize: 12 }}>No jobs yet.</p>
        ) : (
          jobs.map((job) => (
            <div key={job.id} className="job-row" onClick={() => onSelectJob(job)}>
              <div className="job-ico"><TbHistory /></div>
              <div className="job-info">
                <div className="job-name">{job.name}</div>
                <div className="job-meta">ID: {job.id} · Created: {new Date(job.createdAt).toLocaleDateString()} · Assets: {job.assets?.length || 0}</div>
              </div>
              <span className={`badge ${job.status === 'COMPLETED' ? 'b-green' : job.status === 'FAILED' ? 'b-red' : 'b-amber'}`}>
                {job.status}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Prompt Library section (TC_JOBS_003) */}
      <div className="sec">Prompt Library</div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <p style={{ fontSize: 12, color: 'var(--tx3)', margin: 0 }}>
            {savedPrompts.length} prompt template{savedPrompts.length !== 1 ? 's' : ''} saved
          </p>
          <Button variant="primary" onClick={() => setShowNewPrompt(!showNewPrompt)}>
            <TbPlus /> New Prompt
          </Button>
        </div>

        {/* New prompt form */}
        {showNewPrompt && (
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 'var(--r)', padding: '14px', marginBottom: '12px' }}>
            <div className="field">
              <label>Prompt Name</label>
              <Input
                placeholder="e.g. Premium Catalog v3.0"
                value={newPromptName}
                onChange={(e) => setNewPromptName(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Prompt Content</label>
              <textarea
                value={newPromptContent}
                onChange={(e) => setNewPromptContent(e.target.value)}
                placeholder="Generate a photorealistic [MODEL] in [COLOR] paint..."
                style={{
                  width: '100%', minHeight: '100px', fontFamily: "'DM Mono', monospace",
                  fontSize: '11px', padding: '10px', background: 'var(--bg)',
                  border: '1px solid var(--bd)', borderRadius: 'var(--r)', color: 'var(--tx)',
                  resize: 'vertical', outline: 'none'
                }}
              />
            </div>
            <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
              <Button variant="outline" onClick={() => setShowNewPrompt(false)}>Cancel</Button>
              <Button variant="primary" onClick={handleCreatePrompt}>Save Prompt</Button>
            </div>
          </div>
        )}

        {/* Prompt list */}
        {savedPrompts.map((prompt) => (
          <div key={prompt.id} style={{ borderBottom: '1px solid var(--bd)', padding: '10px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                  <TbBook size={14} style={{ color: 'var(--acc)', flexShrink: 0 }} />
                  <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--tx)' }}>{prompt.name}</span>
                  <span className="badge b-gray" style={{ fontSize: '9px' }}>
                    {new Date(prompt.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="prompt-box" style={{ fontSize: '10px', padding: '8px 10px', minHeight: '40px', maxHeight: '80px', overflowY: 'auto' }}>
                  {prompt.content}
                </div>
              </div>
              <Button variant="ghost" onClick={() => handleDeletePrompt(prompt.id)} style={{ marginLeft: '8px', color: 'var(--err)' }}>
                <TbTrash size={14} />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
