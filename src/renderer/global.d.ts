/// <reference types="vite/client" />
import type { ElevenApi } from '../preload/preload';

declare global {
  interface Window {
    api: ElevenApi;
  }
}

export {};