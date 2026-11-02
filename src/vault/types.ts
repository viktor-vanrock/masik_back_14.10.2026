export type VaultResponse<T> = {
  data?: T;
  errors?: string[];
};

export type VaultHmacResponse = {
  hmac: string;
};

export type VaultVerifyResponse = {
  valid: boolean;
};
