// REST API client for Kaspa (https://api.kaspa.org)
const API_ENDPOINTS = {
  mainnet: 'https://api.kaspa.org',
  'testnet-10': 'https://api-tn10.kaspa.org',
  'testnet-11': 'https://api-tn11.kaspa.org',
};

export class KaspaApi {
  constructor(network = 'mainnet') {
    const endpoint = API_ENDPOINTS[network];
    if (!endpoint) throw new Error(`Unknown network "${network}". Supported: ${Object.keys(API_ENDPOINTS).join(', ')}`);
    this.baseUrl = endpoint;
  }

  async _fetch(path, options) {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API error ${response.status}: ${text}`);
    }
    return response.json();
  }

  async getFeeEstimate() { return this._fetch('/info/fee-estimate'); }
}

let apiInstance = null;
let apiNetwork = null;

export function getApi(network) {
  if (!apiInstance || apiNetwork !== network) {
    apiInstance = new KaspaApi(network);
    apiNetwork = network;
  }
  return apiInstance;
}
