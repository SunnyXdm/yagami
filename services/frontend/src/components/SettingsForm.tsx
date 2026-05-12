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
        <div className="flex justify-end px-4 py-3">
          <button
            type="button"
            onClick={onReveal}
            className="button-secondary-dark gap-2"
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
    <div className="grid grid-cols-1 gap-4 px-4 py-4 xl:grid-cols-[260px_1fr]">
      <div>
        <div className="flex items-center gap-2">
          <div className="text-[15px] font-medium leading-[1.4] text-text">{settingLabel(setting.key)}</div>
          {meta?.required && (
            <span className="rounded-[6px] border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-body">
              required
            </span>
          )}
        </div>
        <div className="mt-2 text-[12px] text-stone">{setting.key}</div>
        {settingHelp(setting) && (
          <div className="mt-2 max-w-sm text-[13px] leading-[1.5] text-body">{settingHelp(setting)}</div>
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
              "textarea-dark resize-y",
              setting.is_secret && "font-mono",
              error ? "border-err" : dirty ? "border-white/15" : "border-border",
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
              "input-dark",
              setting.is_secret && "font-mono",
              error ? "border-err" : dirty ? "border-white/15" : "border-border",
            )}
          />
        )}
        {error && <div className="mt-2 text-[13px] text-err">{error}</div>}
      </div>
    </div>
  );
}
