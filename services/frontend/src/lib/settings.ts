export interface Setting {
  key: string;
  value: string;
  description?: string | null;
  is_secret: boolean;
  updated_at: string;
}

export type SettingsStatus = Record<string, boolean>;

export interface FieldMeta {
  key: string;
  label: string;
  help: string;
  placeholder?: string;
  multiline?: boolean;
  required?: boolean;
}

export interface SettingsSection {
  id: string;
  title: string;
  summary: string;
  keys: string[];
  setup?: boolean;
}

export const MASKED_SECRET = "••••••";

export const FIELD_META: Record<string, FieldMeta> = {
  "google.client_id": {
    key: "google.client_id",
    label: "Google OAuth client ID",
    help: "Create a Web application OAuth client in Google Cloud and add this app's callback URL.",
    placeholder: "1234567890-abc.apps.googleusercontent.com",
    required: true,
  },
  "google.client_secret": {
    key: "google.client_secret",
    label: "Google OAuth client secret",
    help: "The secret paired with the client ID. It is stored server-side and masked by default.",
    placeholder: "GOCSPX-...",
    required: true,
  },
  "google.refresh_token": {
    key: "google.refresh_token",
    label: "Google refresh token",
    help: "Created automatically after the browser authorization step. You usually do not paste this manually.",
    required: true,
  },
  "google.auth_status": {
    key: "google.auth_status",
    label: "Google auth health",
    help: "Updated by the poller. If it shows invalid_grant or an error, re-authorize Google.",
  },
  "telegram.bot_token": {
    key: "telegram.bot_token",
    label: "Telegram bot token",
    help: "Create a bot with @BotFather, then add it as admin to the destination channels.",
    placeholder: "123456789:AA...",
    required: true,
  },
  "telegram.chat_likes": {
    key: "telegram.chat_likes",
    label: "Liked videos channel",
    help: "Numeric Telegram chat/channel ID for liked videos and completed downloads.",
    placeholder: "-1001234567890",
    required: true,
  },
  "telegram.chat_history": {
    key: "telegram.chat_history",
    label: "Watch history channel",
    help: "Numeric Telegram chat/channel ID for watch-history notifications.",
    placeholder: "-1001234567890",
    required: true,
  },
  "telegram.chat_subs": {
    key: "telegram.chat_subs",
    label: "Subscriptions channel",
    help: "Numeric Telegram chat/channel ID for subscription and unsubscription events.",
    placeholder: "-1001234567890",
    required: true,
  },
  "telegram.admin_user_id": {
    key: "telegram.admin_user_id",
    label: "Admin Telegram user ID",
    help: "Your numeric Telegram user ID. Used for direct status and admin command replies.",
    placeholder: "123456789",
    required: true,
  },
  "youtube.cookies": {
    key: "youtube.cookies",
    label: "YouTube cookies.txt",
    help: "Netscape-format cookies from a logged-in browser session. Required for watch-history scraping.",
    placeholder: "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t...",
    multiline: true,
    required: true,
  },
  "poll.interval_likes": {
    key: "poll.interval_likes",
    label: "Likes polling interval",
    help: "Seconds between liked-video checks.",
    placeholder: "300",
  },
  "poll.interval_history": {
    key: "poll.interval_history",
    label: "History polling interval",
    help: "Seconds between watch-history checks.",
    placeholder: "600",
  },
  "poll.interval_subs": {
    key: "poll.interval_subs",
    label: "Subscriptions polling interval",
    help: "Seconds between subscription-list checks.",
    placeholder: "900",
  },
  "downloader.max_concurrent": {
    key: "downloader.max_concurrent",
    label: "Concurrent downloads",
    help: "How many videos the downloader may fetch at once.",
    placeholder: "2",
  },
  "downloader.max_filesize_gb": {
    key: "downloader.max_filesize_gb",
    label: "Max file size",
    help: "Largest video file to keep, in GB.",
    placeholder: "2",
  },
  "telegram.api_id": {
    key: "telegram.api_id",
    label: "Telegram API ID",
    help: "Advanced user-account mode only. Not needed for bot mode.",
  },
  "telegram.api_hash": {
    key: "telegram.api_hash",
    label: "Telegram API hash",
    help: "Advanced user-account mode only. Not needed for bot mode.",
  },
  "telegram.session_string": {
    key: "telegram.session_string",
    label: "Telethon session string",
    help: "Advanced user-account mode only. Generate once with Telethon and paste it here.",
  },
};

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "google",
    title: "Google and YouTube API",
    summary: "Connects to likes and subscriptions through the YouTube Data API.",
    keys: ["google.client_id", "google.client_secret", "google.refresh_token", "google.auth_status"],
    setup: true,
  },
  {
    id: "telegram",
    title: "Telegram delivery",
    summary: "Routes each type of activity to the correct Telegram destination.",
    keys: [
      "telegram.bot_token",
      "telegram.chat_likes",
      "telegram.chat_history",
      "telegram.chat_subs",
      "telegram.admin_user_id",
    ],
    setup: true,
  },
  {
    id: "youtube-history",
    title: "Watch history access",
    summary: "Lets yt-dlp read your private YouTube watch-history feed.",
    keys: ["youtube.cookies"],
    setup: true,
  },
  {
    id: "workers",
    title: "Worker defaults",
    summary: "Operational defaults. These already have safe values and can be changed later.",
    keys: [
      "poll.interval_likes",
      "poll.interval_history",
      "poll.interval_subs",
      "downloader.max_concurrent",
      "downloader.max_filesize_gb",
    ],
  },
  {
    id: "telegram-user",
    title: "Telegram user-account mode",
    summary: "Optional advanced mode. Bot mode is enough for normal delivery.",
    keys: ["telegram.api_id", "telegram.api_hash", "telegram.session_string"],
  },
];

export const REQUIRED_STATUS_KEYS = [
  "google_oauth_configured",
  "google_oauth_authorized",
  "telegram_bot_configured",
  "telegram_chat_likes_set",
  "telegram_chat_history_set",
  "telegram_chat_subs_set",
  "telegram_admin_set",
  "youtube_cookies_set",
];

export function isSystemReady(status?: SettingsStatus): boolean {
  return REQUIRED_STATUS_KEYS.every((key) => status?.[key]);
}

export function sectionFields(section: SettingsSection, settings: Setting[]): Setting[] {
  const byKey = new Map(settings.map((setting) => [setting.key, setting]));
  return section.keys.flatMap((key) => {
    const setting = byKey.get(key);
    return setting ? [setting] : [];
  });
}

export function settingLabel(key: string): string {
  return FIELD_META[key]?.label || key;
}

export function settingHelp(setting: Setting): string {
  return FIELD_META[setting.key]?.help || setting.description || "";
}
