import { Container, getContainer } from "@cloudflare/containers";

interface Env {
  API_CONTAINER: DurableObjectNamespace;
  DATABASE_URL: string;
  JWT_SECRET: string;
  CORS_ORIGINS?: string;
}

export class ApiContainer extends Container {
  defaultPort = 8080;
  // Scale to zero when idle; cold start is just the Go binary + pgx pool.
  sleepAfter = "15m";

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {
      DATABASE_URL: env.DATABASE_URL,
      JWT_SECRET: env.JWT_SECRET,
      APP_ENV: "production",
      CORS_ORIGINS: env.CORS_ORIGINS ?? "*",
      PORT: "8080",
    };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Single container instance: the API is stateless, but one instance
    // means one Postgres connection pool. Revisit with getRandom() +
    // max_instances if load ever demands it.
    return getContainer(env.API_CONTAINER).fetch(request);
  },
};
