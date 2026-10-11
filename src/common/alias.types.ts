export interface Alias<T> {
  key: string;
  value: T;
}

export interface IApiAlias {
  key: string;
  value: unknown;
}

export type ApiAlias = IApiAlias;
