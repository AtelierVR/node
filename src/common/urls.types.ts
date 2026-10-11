export interface ApiProxifiedUrl {
  proxified: string;
  original: string;
}

export type ApiUrl = ApiProxifiedUrl['proxified'] | ApiProxifiedUrl;
