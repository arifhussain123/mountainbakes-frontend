// Re-export API client so the rest of the app imports from @/utils/api
export { apiCall, ApiError } from '@/lib/api/client';

// The API base URL is resolved in exactly one place — lib/api/client.ts. A second
// copy lived here and drifted: it still described requests as being proxied to a
// co-located API, which stopped being true when the /api/* rewrite was removed.
//
// An API_ENDPOINTS map lived here too and went the same way: nothing imported it,
// so nothing kept it honest, and it had already drifted from the routes the API
// actually serves. Endpoint paths are written at the call site, next to the
// request that uses them.
