export type TabId = 'home' | 'setup' | 'generate' | 'review' | 'deliver' | 'history' | 'profile';

export type Job = {
  id: number;
  name: string;
  status: 'PENDING' | 'PROCESSING' | 'QA_PENDING' | 'COMPLETED' | 'FAILED';
  createdAt: string;
  updatedAt: string;
  statusHistory?: any;
  assets?: Asset[];
  generation?: {
    id: number;
    metadata: any;
  } | null;
  prompt?: {
    id: number;
    name: string;
    content: string;
  } | null;
  // Add the provider property here:
  provider?: {
    id: number;
    name: string;
  } | null;
};

export type Asset = {
  id: number;
  type: string;
  path: string;
  status: 'pending' | 'done' | 'error' | 'approved' | 'rejected';
};

export type Provider = {
  id: number;
  name: string;
  default: boolean;
  hasApiKey?: boolean;
};