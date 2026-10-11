import type { Tag } from '@/common/tags.types';
import type { IApiAsset } from '@/assets/asset.types';

export interface IApiModAsset extends IApiAsset {
  type: 'mod';
}

export interface GithubFileResponse {
  type: string;
  encoding: string;
  content: string;
}

export interface GithubModManifest {
  id: string;
  type: 'mod';
  provides?: string[];
  name: string;
  description: string;
  icon: string | null;
  license: string;
  tags?: string[];
  authors: Array<{ name: string }>;
  contact?: {
    source?: string;
    website?: string;
  };
}

export interface GithubReleaseAsset {
  name: string;
  size: number;
  content_type: string;
  browser_download_url: string;
  uploader?: {
    login: string;
  } | null;
}

export interface GithubReleaseResponse {
  id: number;
  name: string | null;
  body: string | null;
  tag_name: string;
  published_at: string | null;
  prerelease: boolean;
  html_url: string;
  draft: boolean;
  assets: GithubReleaseAsset[];
}

export interface GithubReleaseManifestFile {
  url: string;
  platforms: string[];
  hash: Tag;
  size: number;
}

export interface GithubReleaseManifest {
  version: string;
  files: GithubReleaseManifestFile[];
}

export interface GithubModRepository {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  html_url: string;
  default_branch?: string;
  created_at: string;
  updated_at: string;
}

export interface GithubAssetContext {
  manifest: GithubModManifest;
  repository: GithubModRepository;
  latestRelease: GithubReleaseResponse | null;
  latestReleaseManifest: GithubReleaseManifest | null;
}

export interface GithubRepositoryConfig {
  id: string;
  githubId: number;
  aliases: string[];
  owner: string;
  repo: string;
}

export interface GithubRepositoryManifest {
  manifest: GithubModManifest;
  repository: GithubModRepository;
}
