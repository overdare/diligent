// @summary Runtime-owned provider authentication labels and masked credential status

import type { ProviderManager, ProviderName } from "@diligent/core/provider-contract";

export interface ExternalProviderAuthPresentation {
  maskedKey: string;
  oauth?: boolean;
}

export interface ProviderAuthPresentationStatus {
  configured: boolean;
  maskedKey: string | undefined;
  oauthConnected: boolean | undefined;
}

export class ProviderAuthPresenter {
  private readonly externalAuth: Partial<Record<ProviderName, ExternalProviderAuthPresentation>> = {};

  constructor(private readonly providerManager: ProviderManager) {}

  setExternalAuth(provider: ProviderName, presentation: ExternalProviderAuthPresentation): void {
    this.externalAuth[provider] = presentation;
  }

  removeExternalAuth(provider: ProviderName): void {
    delete this.externalAuth[provider];
  }

  getStatus(provider: ProviderName): ProviderAuthPresentationStatus {
    const configured = this.providerManager.hasKeyFor(provider);
    const apiKey = this.providerManager.getApiKey(provider);
    const external = this.externalAuth[provider];
    let maskedKey: string | undefined;
    if (configured) {
      if (!apiKey) {
        maskedKey = external?.maskedKey;
      } else if (apiKey.length > 7) {
        maskedKey = `${apiKey.slice(0, 7)}...`;
      } else {
        maskedKey = apiKey;
      }
    }
    return {
      configured,
      maskedKey,
      oauthConnected: external?.oauth ? configured : undefined,
    };
  }
}
