// Reserved for future API integration. Import this value in the API layer;
// the initial dashboard deliberately makes no backend requests.
export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL?.trim() || 'http://127.0.0.1:8000/api'
).replace(/\/+$/, '')
