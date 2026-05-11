import { Eye, EyeOff } from "lucide-react";
import { cn } from "../lib/utils";
import {
  FIELD_META,
  MASKED_SECRET,
  type Setting,
  settingHelp,
  settingLabel,
} from "../lib/settings";

interface SettingsFormProps {
  settings: Setting[];
  draft: Record<string, string>;
  errors: Record<string, string>;
  reveal?: boolean;
  onReveal?: () => void;
  onChange: (key: string, value: string) => void;
}

export function SettingsForm({
  settings,
  draft,
  errors,
  reveal,
  onReveal,
  onChange,
}: SettingsFormProps) {
  return (
    <div className="divide-y divide-border">
      {settings.map((setting) => (
        <SettingField
          key={setting.key}
          setting={setting}
          value={draft[setting.key] ?? setting.value ?? ""}
          dirty={draft[setting.key] !== undefined}
          error={errors[setting.key]}
          onChange={(value) => onChange(setting.key, value)}
        />
      ))}
      {onReveal && (
        <div className="px-4 py-3 flex justify-end">
          <button
            type="button"
            onClick={onReveal}
            className="text-xs flex items-center gap-2 text-muted hover:text-text"
          >
            {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
            {reveal ? "hide secret values" : "reveal saved secrets"}
          </button>
        </div>
      )}
    </div>
  );
}

function SettingField({
  setting,
  value,
  dirty,
  error,
  onChange,
}: {
  setting: Setting;
  value: string;
  dirty: boolean;
  error?: string;
  onChange: (value: string) => void;
}) {
  const meta = FIELD_META[setting.key];
  const multiline = meta?.multiline || setting.key === "youtube.cookies";
  const inputType = setting.is_secret && value === MASKED_SECRET ? "password" : "text";

  return (
    <div className="px-4 py-4 grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3">
      <div>
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium">{settingLabel(setting.key)}</div>
          {meta?.required && <span className="text-[10px] uppercase tracking-wide text-accent">required</span>}
        </div>
        <div className="text-[11px] text-muted font-mono mt-1">{setting.key}</div>
        {settingHelp(setting) && (
          <div className="text-xs text-muted mt-2 leading-relaxed max-w-sm">{settingHelp(setting)}</div>
        )}
      </div>
      <div>
        {multiline ? (
          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={meta?.placeholder}
            spellCheck={false}
            className={cn(
              "w-full min-h-36 bg-bg border rounded-lg px-3 py-2 text-xs font-mono resize-y focus:outline-none focus:ring-2 focus:ring-accent2/50",
              error ? "border-err" : dirty ? "border-accent2" : "border-border",
            )}
          />
        ) : (
          <input
            type={inputType}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={meta?.placeholder}
            spellCheck={false}
            className={cn(
              "w-full bg-bg border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent2/50",
              setting.is_secret && "font-mono",
              error ? "border-err" : dirty ? "border-accent2" : "border-border",
            )}
          />
        )}
        {error && <div className="text-xs text-err mt-1">{error}</div>}
      </div>
    </div>
  );
}
