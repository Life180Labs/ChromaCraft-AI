export type TabId = 'home' | 'setup' | 'generate' | 'review' | 'deliver' | 'history';

export type Job = {
  id: number;
  name: string;
  status: 'PENDING' | 'PROCESSING' | 'QA_PENDING' | 'COMPLETED' | 'FAILED';
  createdAt: string;
  updatedAt: string;
  assets?: Asset[];
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
};
