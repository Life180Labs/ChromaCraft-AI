'use client';

import React from 'react';
import { TbUpload } from 'react-icons/tb';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

type UploadSetupProps = {
  jobName: string;
  onJobNameChange: (v: string) => void;
  uploadFile: File | null;
  onFileChange: (f: File | null) => void;
  uploadError: string;
  loading: boolean;
  onSubmit: (e: React.FormEvent) => void;
};

export const UploadSetup: React.FC<UploadSetupProps> = ({
  jobName, onJobNameChange, uploadFile, onFileChange, uploadError, loading, onSubmit,
}) => {
  return (
    <div className="screen active">
      <div className="sec">Upload Asset</div>
      <div className="card">
        <form onSubmit={onSubmit}>
          <div className="field">
            <label>Project Name</label>
            <Input placeholder="e.g. Leather Bag Shoot" value={jobName} onChange={(e) => onJobNameChange(e.target.value)} required />
          </div>
          <div className="field">
            <label>Asset File</label>
            <div className="uzone" onClick={() => document.getElementById('file-picker')?.click()}>
              <TbUpload style={{ fontSize: '28px', display: 'block', margin: '0 auto 6px' }} />
              <p>{uploadFile ? uploadFile.name : 'Click to upload — device, URL, or cloud'}</p>
              <small>PNG · JPG · min 800×600 · up to 10MB</small>
            </div>
            <input
              id="file-picker"
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => onFileChange(e.target.files?.[0] || null)}
            />
          </div>
          {uploadError && <div className="notice err">{uploadError}</div>}
          <div className="btn-row" style={{ marginTop: 16 }}>
            <Button type="submit" variant="primary" disabled={loading}>
              {loading ? 'Uploading...' : 'Create & Upload'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
