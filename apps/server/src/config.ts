import path from "node:path";

const env = (k: string) => (process.env[k] ?? "").trim();

export const config = {
  port: Number(env("PORT") || 8787),
  host: env("HOST") || "127.0.0.1",
  dataDir: path.resolve(process.cwd(), env("DATA_DIR") || "../../data"),
  password: env("APP_PASSWORD"),
  anymodelBase: (env("ANYMODEL_BASE_URL") || "https://anymodel.org/v1").replace(/\/+$/, ""),
  keys: {
    anymodel: env("ANYMODEL_API_KEY"),
    youtube: env("YOUTUBE_API_KEY"),
    /** Резервные ключи YouTube: подхватываются по очереди, когда кончается квота */
    youtube2: env("YOUTUBE_API_KEY_2"),
    youtube3: env("YOUTUBE_API_KEY_3"),
    gemini: env("GEMINI_API_KEY"),
    lumean: env("LUMEAN_API_KEY"),
    anthropic: env("ANTHROPIC_API_KEY"),
    openai: env("OPENAI_API_KEY"),
  },
};

export type Provider = keyof typeof config.keys;
