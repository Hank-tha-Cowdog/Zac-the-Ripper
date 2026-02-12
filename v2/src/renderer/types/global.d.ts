import type { ZtrAPI } from '../../main/preload'

declare global {
  interface Window {
    ztr: ZtrAPI
  }
}
