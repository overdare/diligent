// @summary OAuth token types for ChatGPT subscription authentication

export interface OpenAIOAuthTokens {
  access_token: string;
  refresh_token: string;
  id_token: string;
  /** Unix timestamp in milliseconds */
  expires_at: number;
  /** ChatGPT account ID extracted from JWT claims (for ChatGPT-Account-Id header) */
  account_id?: string;
}
