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
    <div className="divide-y divide-hairline">
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
        <div className="flex justify-end px-6 py-4">
          <button
            type="button"
            onClick={onReveal}
            className="button-secondary-light gap-2"
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
    <div className="grid grid-cols-1 gap-4 px-6 py-6 xl:grid-cols-[300px_1fr]">
      <div>
        <div className="flex items-center gap-2">
          <div className="text-[20px] leading-[1.2] tracking-[-0.01em] text-ink">{settingLabel(setting.key)}</div>
          {meta?.required && (
            <span className="rounded-full border border-ink bg-ink px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-text">
              required
            </span>
          )}
        </div>
        <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">{setting.key}</div>
        {settingHelp(setting) && (
          <div className="mt-3 max-w-sm text-[14px] leading-[1.5] text-muted">{settingHelp(setting)}</div>
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
              "textarea-light resize-y font-mono",
              error ? "border-err" : dirty ? "border-ink" : "border-hairline",
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
              "input-light",
              setting.is_secret && "font-mono",
              error ? "border-err" : dirty ? "border-ink" : "border-hairline",
            )}
          />
        )}
        {error && <div className="mt-2 text-[13px] text-err">{error}</div>}
      </div>
    </div>
  );
}
