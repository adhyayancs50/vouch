// Backend root URL; endpoint paths belong in the API layer.
export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL?.trim() || 'http://127.0.0.1:8000'
).replace(/\/+$/, '')

// Public development identity only. This is not authentication or a secret.
export const DEV_EMPLOYER_KEY = import.meta.env.VITE_DEV_EMPLOYER_KEY?.trim() || ''
