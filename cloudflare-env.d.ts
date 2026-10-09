declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    SKILLHUB_WORKSPACE_ORIGINS?: string;
  }
}
