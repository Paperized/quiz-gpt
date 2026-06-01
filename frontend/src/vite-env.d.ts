/// <reference types="vite/client" />

declare global {
  interface Window {
    __APP_CONFIG__?: {
      publicUrl?: string;
    };
  }
}

export {};
