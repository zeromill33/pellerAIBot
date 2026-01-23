import { loadTelegramConfig } from "./config/load.js";
import { startTelegramBot } from "./bot/telegram.js";

async function main() {
  const config = loadTelegramConfig();
  await startTelegramBot(config);
  console.info({ message: "telegram_bot_started" });
}

main().catch((error) => {
  console.error({
    message: "telegram_bot_start_failed",
    error: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});
