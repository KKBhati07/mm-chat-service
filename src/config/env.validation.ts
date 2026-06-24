import * as Joi from 'joi';

/** Default CORS / Socket.IO origins for local MarketMate development. */
export const DEFAULT_ALLOWED_APP_ORIGINS =
  'https://marketmate.local:4200,https://admin.marketmate.local:4300,http://localhost:4200,http://localhost:4300';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  PORT: Joi.number().port().default(3000),

  ALLOWED_APP_ORIGINS: Joi.string()
    .default(DEFAULT_ALLOWED_APP_ORIGINS)
    .description('Comma-separated CORS and Socket.IO allowed origins'),

  JWT_SECRET: Joi.string()
    .min(1)
    .required()
    .description('Must match SpringMate JWT secret'),

  /** Full URL to SpringMate internal session resolve endpoint (preferred). */
  AUTH_RESOLVE_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .description('e.g. https://backend:8080/internal/v1/auth/resolve_session'),

  /** Legacy alias: base URL only if AUTH_RESOLVE_URL is not set. */
  SPRING_BASE_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .description('Deprecated: use AUTH_RESOLVE_URL with the full resolve path'),

  /** Internal service key for SpringMate auth fallback. */
  SPRING_INTERNAL_SERVICE_KEY: Joi.string()
    .min(1)
    .required()
    .description('Must match SpringMate app.internal.service.key (SERVICE_KEY)'),

  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),

  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().port().required(),
  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),

  /** Local dev only: disable TLS verification for SpringMate self-signed certs. */
  NODE_TLS_REJECT_UNAUTHORIZED: Joi.string().valid('0', '1').optional(),
})
  .or('AUTH_RESOLVE_URL', 'SPRING_BASE_URL')
  .messages({
    'object.missing': 'Configure AUTH_RESOLVE_URL or SPRING_BASE_URL',
  });
