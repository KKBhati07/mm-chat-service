/**
 * Spring Boot API URL constants.
 * These match the routes defined in SpringMate/SpringMate/src/main/java/com/example/SpringMate/Shared/Urls.java
 */
export const SPRING_API_URLS = {
  AUTH: {
    BASE: '/api/v1/auth',
    RESOLVE_SESSION: '/api/v1/auth/resolve_session',
  },
  INTERNAL: {
    AUTH: {
      BASE: '/internal/v1/auth',
      RESOLVE_SESSION: '/internal/v1/auth/resolve-session',
    },
  },
};
